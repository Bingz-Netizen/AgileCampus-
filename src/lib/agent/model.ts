import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";
import { getUserAiConfig } from "@/lib/user";

// DeepSeek 已废弃 deepseek-chat 番号（现返 400 invalid_request_error），现行为 v4 系列。
// flash 迅捷省耗，适配项目管理助手的短问答+工具调用；重推理可经 DEEPSEEK_MODEL 换 deepseek-v4-pro。
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

// 模型解析（BYOK）：用户个人配置（设置 → AI 助手）优先，回落服务器 .env 的 DEEPSEEK_*。
// 仅在生产（route 未注入 model）时调用；测试注入 MockLanguageModelV2，不触达此函数。
export async function getModel(actorId?: string): Promise<LanguageModel> {
  const userConfig = actorId ? await getUserAiConfig(actorId) : null;
  if (userConfig) {
    // 用户自备 key：服务地址未填时默认 DeepSeek 官方端点；模型名未填时同回落规则。
    // 换用其他服务商（月之暗面/通义/豆包…）务必在设置页填写其模型名。
    const provider = createOpenAICompatible({
      name: "user-provider",
      baseURL: userConfig.baseUrl ?? DEFAULT_BASE_URL,
      headers: { Authorization: `Bearer ${userConfig.apiKey}` },
    });
    return provider(userConfig.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "尚未配置 AI 模型：请到「设置 → AI 助手」填写你自己的 API Key（DeepSeek、通义、豆包等 OpenAI 兼容接口均可），或由部署者在 .env 配置 DEEPSEEK_API_KEY",
    );
  }
  const deepseek = createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return deepseek(process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL);
}
