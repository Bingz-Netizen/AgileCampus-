import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "./errors";

// 对称加密：用于个人 AI API Key 的可逆存储（调用模型方须明文出示，无法像密码那样只存哈希）。
// AES-256-GCM：密钥由 AUTH_SECRET 经 sha256 派生（32 字节），每次加密随机 12 字节 IV。
// 存储格式 `base64(iv):base64(tag):base64(ciphertext)`，可整体塞进单个 text 列。
// 依赖 AUTH_SECRET 稳定不变；轮换密钥后旧密文解密失败，按「未配置」处理。

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new AppError("服务器未配置 AUTH_SECRET，无法加密存储 API Key");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

// 解密失败（密文损坏 / AUTH_SECRET 轮换 / 被人篡改）一律返回 null，调用方按「未配置」处理。
export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(":");
    if (parts.length !== 3) return null;
    const [iv, tag, ciphertext] = parts.map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
