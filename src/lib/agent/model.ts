import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";
import { getUserAiConfig } from "@/lib/user";

// AI 助手模型解析：每人用自己的配置（BYOK），不共享服务器 Key。
// 只要求 OpenAI 兼容接口——服务地址与模型名由用户在「设置 → AI 助手」填写。
const CONFIG_HINT = "请到「设置 → AI 助手」填写你自己的 API Key、服务地址与模型名";

export async function getModel(actorId: string): Promise<LanguageModel> {
  const userConfig = await getUserAiConfig(actorId);
  if (!userConfig) throw new AppError(`尚未配置 AI 助手：${CONFIG_HINT}（支持任意 OpenAI 兼容接口）`);
  if (!userConfig.baseUrl) throw new AppError(`未填写服务地址，${CONFIG_HINT}`);
  if (!userConfig.model) throw new AppError(`未填写模型名，${CONFIG_HINT}`);

  const provider = createOpenAICompatible({
    name: "user-provider",
    baseURL: userConfig.baseUrl,
    headers: { Authorization: `Bearer ${userConfig.apiKey}` },
  });
  return provider(userConfig.model);
}
