import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createUser, setUserAiConfig, getUserAiConfig } from "@/lib/user";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { resetDb } from "./helpers";

describe("crypto 加密工具", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("加密再解密还原明文，且密文不等于明文", () => {
    const enc = encryptSecret("sk-test-123");
    expect(enc).not.toBe("sk-test-123");
    expect(decryptSecret(enc)).toBe("sk-test-123");
  });

  it("两次加密同一明文产出不同密文（随机 IV）", () => {
    expect(encryptSecret("sk-same")).not.toBe(encryptSecret("sk-same"));
  });

  it("密文被篡改或格式非法时解密返回 null", () => {
    expect(decryptSecret("not-a-valid-payload")).toBeNull();
    const enc = encryptSecret("sk-orig");
    const [iv, tag, ct] = enc.split(":");
    const tampered = [iv, tag, Buffer.from("tampered").toString("base64")].join(":");
    expect(decryptSecret(tampered)).toBeNull();
    expect(decryptSecret(`${iv}:${tag}:${ct}:extra`)).toBeNull();
  });

  it("缺 AUTH_SECRET 时加密抛出可展示错误", () => {
    vi.stubEnv("AUTH_SECRET", undefined);
    expect(() => encryptSecret("sk-x")).toThrow(AppError);
  });
});

describe("setUserAiConfig / getUserAiConfig（每人一份，互不共享）", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("key 加密落库，读取时还原；空白字段存 null", async () => {
    const user = await createUser({ email: "ai@example.com", password: "password123", name: "甲" });
    await setUserAiConfig(user.id, {
      apiKey: "sk-personal-abc",
      baseUrl: "  ",
      model: " moonshot-v1-8k ",
    });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.aiApiKeyEnc).toBeTruthy();
    expect(row.aiApiKeyEnc).not.toContain("sk-personal-abc");
    expect(row.aiBaseUrl).toBeNull();
    expect(row.aiModel).toBe("moonshot-v1-8k");

    expect(await getUserAiConfig(user.id)).toEqual({
      apiKey: "sk-personal-abc",
      baseUrl: null,
      model: "moonshot-v1-8k",
    });
  });

  it("两个用户的配置互不影响", async () => {
    const a = await createUser({ email: "a@example.com", password: "password123", name: "甲" });
    const b = await createUser({ email: "b@example.com", password: "password123", name: "乙" });
    await setUserAiConfig(a.id, {
      apiKey: "sk-a",
      baseUrl: "https://a.example.com/v1",
      model: "model-a",
    });

    expect(await getUserAiConfig(a.id)).toMatchObject({ apiKey: "sk-a", model: "model-a" });
    expect(await getUserAiConfig(b.id)).toBeNull();

    await setUserAiConfig(b.id, {
      apiKey: "sk-b",
      baseUrl: "https://b.example.com/v1",
      model: "model-b",
    });
    expect(await getUserAiConfig(a.id)).toMatchObject({ apiKey: "sk-a" });
    expect(await getUserAiConfig(b.id)).toMatchObject({ apiKey: "sk-b" });
  });

  it("空 key 清除全部三项", async () => {
    const user = await createUser({ email: "clear@example.com", password: "password123", name: "丙" });
    await setUserAiConfig(user.id, {
      apiKey: "sk-tmp",
      baseUrl: "https://a.example.com",
      model: "model-a",
    });
    await setUserAiConfig(user.id, { apiKey: "", baseUrl: "", model: "" });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.aiApiKeyEnc).toBeNull();
    expect(row.aiBaseUrl).toBeNull();
    expect(row.aiModel).toBeNull();
    expect(await getUserAiConfig(user.id)).toBeNull();
  });

  it("从未配置的用户返回 null", async () => {
    const user = await createUser({ email: "none@example.com", password: "password123", name: "丁" });
    expect(await getUserAiConfig(user.id)).toBeNull();
  });
});

describe("getModel（只用本人配置，不共享服务器 Key）", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // 模型对象不暴露 modelId，故以真实请求为证据：拦截 fetch，断言端点、鉴权头与模型名。
  async function runTurnAndCapture(actorId: string) {
    const captured: { url: string; auth: string | null; body: Record<string, unknown> } = {
      url: "",
      auth: null,
      body: {},
    };
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured.url = String(_url);
      captured.auth = new Headers(init?.headers).get("authorization");
      captured.body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: captured.body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "你好" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { generateText } = await import("ai");
    const { getModel: gm } = await import("@/lib/agent/model");
    const result = await generateText({
      model: await gm(actorId),
      messages: [{ role: "user", content: "你好" }],
    });
    return { captured, result };
  }

  it("用本人的 key、服务地址与模型名发起请求", async () => {
    const user = await createUser({ email: "byok@example.com", password: "password123", name: "戊" });
    await setUserAiConfig(user.id, {
      apiKey: "sk-mine",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
    });

    const { captured, result } = await runTurnAndCapture(user.id);
    expect(result.text).toContain("你好");
    expect(captured.url).toContain("https://api.moonshot.cn/v1/chat/completions");
    expect(captured.auth).toBe("Bearer sk-mine");
    expect(captured.body.model).toBe("moonshot-v1-8k");
  });

  it("队友的配置不会被借用：A 有配置，B 仍然报未配置", async () => {
    const a = await createUser({ email: "owner@example.com", password: "password123", name: "甲" });
    const b = await createUser({ email: "other@example.com", password: "password123", name: "乙" });
    await setUserAiConfig(a.id, {
      apiKey: "sk-a",
      baseUrl: "https://a.example.com/v1",
      model: "model-a",
    });

    const { getModel: gm } = await import("@/lib/agent/model");
    await expect(gm(b.id)).rejects.toThrow(AppError);
    await expect(gm(b.id)).rejects.toThrow(/设置/);
  });

  it("没配置时抛错并指向设置页", async () => {
    const user = await createUser({ email: "nokey@example.com", password: "password123", name: "癸" });
    const { getModel: gm } = await import("@/lib/agent/model");
    await expect(gm(user.id)).rejects.toThrow(AppError);
    await expect(gm(user.id)).rejects.toThrow(/设置/);
  });

  it("缺服务地址或模型名时给出具体提示", async () => {
    const u1 = await createUser({ email: "nobase@example.com", password: "password123", name: "子" });
    await setUserAiConfig(u1.id, { apiKey: "sk-x", baseUrl: "", model: "model-x" });
    const { getModel: gm } = await import("@/lib/agent/model");
    await expect(gm(u1.id)).rejects.toThrow(/服务地址/);

    const u2 = await createUser({ email: "nomodel@example.com", password: "password123", name: "丑" });
    await setUserAiConfig(u2.id, { apiKey: "sk-x", baseUrl: "https://x.example.com/v1", model: "" });
    await expect(gm(u2.id)).rejects.toThrow(/模型名/);
  });
});
