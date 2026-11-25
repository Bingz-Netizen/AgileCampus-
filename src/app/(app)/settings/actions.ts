"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { unbindFeishu, setUserAiConfig, getUserAiConfig } from "@/lib/user";
import { AppError } from "@/lib/errors";

export async function unbindFeishuAction() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  await unbindFeishu(session.user.id);
  revalidatePath("/settings");
}

// AI 助手个人配置（BYOK）。不绑定厂商：只要求 OpenAI 兼容接口的「地址 + 模型名」。
export type AiConfigState = { ok: string } | { error: string } | null;

const aiConfigSchema = z.object({
  apiKey: z.string().trim().max(256, "API Key 过长"),
  baseUrl: z
    .string()
    .trim()
    .max(256, "服务地址过长")
    .refine((v) => v === "" || /^https?:\/\//.test(v), "服务地址须以 http:// 或 https:// 开头"),
  model: z.string().trim().max(128, "模型名过长"),
});

export async function saveAiConfigAction(
  _prev: AiConfigState,
  formData: FormData,
): Promise<AiConfigState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = aiConfigSchema.safeParse({
    apiKey: formData.get("apiKey") ?? "",
    baseUrl: formData.get("baseUrl") ?? "",
    model: formData.get("model") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    if (formData.get("clear") === "1") {
      await setUserAiConfig(session.user.id, { apiKey: "", baseUrl: "", model: "" });
      revalidatePath("/settings");
      return { ok: "已清除个人配置——AI 助手将不可用，重新填写后才能继续使用。" };
    }

    // 留空的字段保持原值；没有任何可用配置时要求至少填写 Key 与模型
    const existing = await getUserAiConfig(session.user.id);
    const apiKey = parsed.data.apiKey || existing?.apiKey;
    if (!apiKey) return { error: "请填写 API Key（或由部署者在服务器环境变量中配置）" };

    const baseUrl = parsed.data.baseUrl || existing?.baseUrl || "";
    if (!baseUrl) return { error: "请填写服务地址（例如 https://api.deepseek.com/v1）" };
    const model = parsed.data.model || existing?.model || "";
    if (!model) return { error: "请填写模型名（例如 deepseek-flash、qwen-plus、moonshot-v1-8k）" };

    await setUserAiConfig(session.user.id, { apiKey, baseUrl, model });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "已保存——AI 助手将使用你的配置。" };
}
