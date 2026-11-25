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

describe("setUserAiConfig / getUserAiConfig", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("key 加密落库，读取时还原；空服务地址与模型名存 null", async () => {
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

  it("再次保存覆盖旧配置", async () => {
    const user = await createUser({ email: "over@example.com", password: "password123", name: "乙" });
    await setUserAiConfig(user.id, {
      apiKey: "sk-old",
      baseUrl: "https://a.example.com",
      model: "model-a",
    });
    await setUserAiConfig(user.id, {
      apiKey: "sk-new",
      baseUrl: "https://b.example.com/v1",
      model: "model-b",
    });
    expect(await getUserAiConfig(user.id)).toEqual({
      apiKey: "sk-new",
      baseUrl: "https://b.example.com/v1",
      model: "model-b",
    });
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

describe("getModel 解析优先级（任意 OpenAI 兼容接口）", () => {
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
      if (captured.body.stream) {
        const sse = [
          `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: captured.body.model, choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: captured.body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
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

  it("个人配置优先：用自己的 key、地址与模型名", async () => {
    const user = await createUser({ email: "byok@example.com", password: "password123", name: "戊" });
    await setUserAiConfig(user.id, {
      apiKey: "sk-mine",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
    });
    vi.stubEnv("AI_API_KEY", "sk-server");
    vi.stubEnv("AI_BASE_URL", "https://server.example.com/v1");
    vi.stubEnv("AI_MODEL", "server-model");

    const { captured, result } = await runTurnAndCapture(user.id);
    expect(result.text).toContain("你好");
    expect(captured.url).toContain("https://api.moonshot.cn/v1/chat/completions");
    expect(captured.auth).toBe("Bearer sk-mine");
    expect(captured.body.model).toBe("moonshot-v1-8k");
  });

  it("个人只填 key 时，地址与模型名回落服务器配置", async () => {
    const user = await createUser({ email: "partial@example.com", password: "password123", name: "己" });
    await setUserAiConfig(user.id, { apiKey: "sk-mine", baseUrl: "", model: "" });
    vi.stubEnv("AI_BASE_URL", "https://server.example.com/v1");
    vi.stubEnv("AI_MODEL", "server-model");

    const { captured } = await runTurnAndCapture(user.id);
    expect(captured.url).toContain("https://server.example.com/v1/chat/completions");
    expect(captured.auth).toBe("Bearer sk-mine");
    expect(captured.body.model).toBe("server-model");
  });

  it("个人 key 就绪但缺模型名与服务器默认值：抛错并指向设置页", async () => {
    const user = await createUser({ email: "nomodel@example.com", password: "password123", name: "庚" });
    await setUserAiConfig(user.id, { apiKey: "sk-mine", baseUrl: "", model: "" });
    vi.stubEnv("AI_MODEL", undefined);
    vi.stubEnv("DEEPSEEK_MODEL", undefined);

    const { getModel: gm } = await import("@/lib/agent/model");
    await expect(gm(user.id)).rejects.toThrow(AppError);
    await expect(gm(user.id)).rejects.toThrow(/设置/);
  });

  it("无个人配置时使用服务器环境变量（通用 AI_* 名）", async () => {
    const user = await createUser({ email: "env@example.com", password: "password123", name: "辛" });
    vi.stubEnv("AI_API_KEY", "sk-server");
    vi.stubEnv("AI_BASE_URL", "https://gateway.example.com/v1");
    vi.stubEnv("AI_MODEL", "qwen-plus");

    const { captured } = await runTurnAndCapture(user.id);
    expect(captured.url).toContain("https://gateway.example.com/v1/chat/completions");
    expect(captured.auth).toBe("Bearer sk-server");
    expect(captured.body.model).toBe("qwen-plus");
  });

  it("兼容历史 DEEPSEEK_* 环境变量名", async () => {
    const user = await createUser({ email: "legacy@example.com", password: "password123", name: "壬" });
    vi.stubEnv("AI_API_KEY", undefined);
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-legacy");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://legacy.example.com/v1");
    vi.stubEnv("DEEPSEEK_MODEL", "legacy-model");

    const { captured } = await runTurnAndCapture(user.id);
    expect(captured.url).toContain("https://legacy.example.com/v1/chat/completions");
    expect(captured.auth).toBe("Bearer sk-legacy");
    expect(captured.body.model).toBe("legacy-model");
  });

  it("个人与服务器都无 key：抛出指向设置页的可展示错误", async () => {
    const user = await createUser({ email: "nokey@example.com", password: "password123", name: "癸" });
    vi.stubEnv("AI_API_KEY", undefined);
    vi.stubEnv("DEEPSEEK_API_KEY", undefined);

    const { getModel: gm } = await import("@/lib/agent/model");
    await expect(gm(user.id)).rejects.toThrow(AppError);
    await expect(gm(user.id)).rejects.toThrow(/设置/);
  });
});
