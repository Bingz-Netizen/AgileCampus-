import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "./password";
import { exchangeOAuthCode } from "./feishu";
import { encryptSecret, decryptSecret } from "./crypto";
import { AppError, isUniqueViolation } from "./errors";

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw new AppError("该邮箱已被注册");

  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: input.name })
      .returning({ id: users.id, email: users.email, name: users.name });
    return user;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先注册，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("该邮箱已被注册");
    throw e;
  }
}

// 绑定当前用户的飞书身份。open_id 唯一——已被他人绑定则转译友好错误。
export async function bindFeishu(userId: string, input: { openId: string; name: string }) {
  try {
    await db
      .update(users)
      .set({ feishuOpenId: input.openId, feishuName: input.name, feishuBoundAt: sql`now()` })
      .where(eq(users.id, userId));
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("该飞书账号已绑定其他用户");
    throw e;
  }
}

export async function unbindFeishu(userId: string) {
  await db
    .update(users)
    .set({ feishuOpenId: null, feishuName: null, feishuBoundAt: null })
    .where(eq(users.id, userId));
}

// 飞书登录的账号解析：已绑 openId → 返回原账号；未绑 → 自动建号（占位 email + 不可用 hash，禁邮箱登录）。
export async function findOrCreateByFeishu(input: { openId: string; name: string }) {
  const [existing] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.feishuOpenId, input.openId));
  if (existing) return existing;

  const email = `${input.openId.toLowerCase()}@feishu.local`;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  try {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: input.name,
        feishuOpenId: input.openId,
        feishuName: input.name,
        feishuBoundAt: sql`now()`,
      })
      .returning({ id: users.id, email: users.email, name: users.name });
    return user;
  } catch (e) {
    // 并发：另一请求已为同一 openId 抢先建号 → 回查复用
    if (isUniqueViolation(e)) {
      const [u] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.feishuOpenId, input.openId));
      if (u) return u;
    }
    throw e;
  }
}

// 飞书登录归一入口：一次性 code → openId → 找/建账号。OAuth 与 JSSDK 两路共用。
export async function loginWithFeishuCode(code: string) {
  const { openId, name } = await exchangeOAuthCode(code);
  return findOrCreateByFeishu({ openId, name });
}

// ---- AI 助手个人配置（BYOK）----
// 用户自填 OpenAI 兼容接口的 API Key / 服务地址 / 模型名，仅本人请求生效；
// 未配置者回落服务器 .env 的 DEEPSEEK_*。key 加密落库，服务地址与模型名明文。

export interface UserAiConfig {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

export async function setUserAiConfig(
  userId: string,
  input: { apiKey: string; baseUrl: string; model: string },
): Promise<void> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    // 空 key = 清除个人配置（三个字段同生共死），回落服务器配置
    await db
      .update(users)
      .set({ aiApiKeyEnc: null, aiBaseUrl: null, aiModel: null })
      .where(eq(users.id, userId));
    return;
  }
  const aiApiKeyEnc = encryptSecret(apiKey);
  const aiBaseUrl = input.baseUrl.trim() || null;
  const aiModel = input.model.trim() || null;
  await db
    .update(users)
    .set({ aiApiKeyEnc, aiBaseUrl, aiModel })
    .where(eq(users.id, userId));
}

export async function getUserAiConfig(userId: string): Promise<UserAiConfig | null> {
  const [row] = await db
    .select({ aiApiKeyEnc: users.aiApiKeyEnc, aiBaseUrl: users.aiBaseUrl, aiModel: users.aiModel })
    .from(users)
    .where(eq(users.id, userId));
  if (!row?.aiApiKeyEnc) return null;
  const apiKey = decryptSecret(row.aiApiKeyEnc);
  if (!apiKey) return null; // 解密失败（如 AUTH_SECRET 轮换）按未配置处理
  return { apiKey, baseUrl: row.aiBaseUrl, model: row.aiModel };
}
