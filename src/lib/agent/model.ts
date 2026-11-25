import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";
import { getUserAiConfig } from "@/lib/user";

// AI 助手模型解析（BYOK）：不绑定具体厂商，只要求 OpenAI 兼容接口。
// 优先用「设置 → AI 助手」里的个人配置；没有个人配置时回落部署者的环境变量。
// 环境变量优先读通用名 AI_*，兼容旧名 DEEPSEEK_*（历史配置无需改动即可继续工作）。
const NOT_CONFIGURED =
  "尚未配置 AI 模型：请到「设置 → AI 助手」填写 API Key、服务地址与模型名（支持任意 OpenAI 兼容接口），或由部署者通过环境变量统一配置。";

function envApiKey(): string {
  return process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
}

function envBaseUrl(): string | null {
  return process.env.AI_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? null;
}

function envModel(): string | null {
  return process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? null;
}

// 仅在路由未注入 model 时调用；测试注入 MockLanguageModelV2，不触达此函数。
export async function getModel(actorId?: string): Promise<LanguageModel> {
  const userConfig = actorId ? await getUserAiConfig(actorId) : null;

  if (userConfig) {
    // 个人配置：服务地址与模型名未填时，允许回落部署者的环境变量
    const baseURL = userConfig.baseUrl ?? envBaseUrl();
    const modelName = userConfig.model ?? envModel();
    if (!baseURL) {
      throw new AppError(
        "请先在「设置 → AI 助手」填写服务地址（例如 OpenAI 兼容接口的 /v1 地址）",
      );
    }
    if (!modelName) {
      throw new AppError("请先在「设置 → AI 助手」填写模型名");
    }
    const provider = createOpenAICompatible({
      name: "user-provider",
      baseURL,
      headers: { Authorization: `Bearer ${userConfig.apiKey}` },
    });
    return provider(modelName);
  }

  const apiKey = envApiKey();
  const baseURL = envBaseUrl();
  const modelName = envModel();
  if (!apiKey || !baseURL || !modelName) throw new AppError(NOT_CONFIGURED);

  const provider = createOpenAICompatible({
    name: "server-provider",
    baseURL,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return provider(modelName);
}
