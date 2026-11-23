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

// AI 助手个人配置（BYOK）。成功回传 ok 提示，失败回传 error。
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
      // 清除按钮：整体移除个人配置，回落服务器配置
      await setUserAiConfig(session.user.id, { apiKey: "", baseUrl: "", model: "" });
      revalidatePath("/settings");
      return { ok: "已清除个人配置——AI 助手将回落服务器配置。" };
    }

    // 留空的字段保持原值；key 也留空且原本没有 → 无从保存
    const existing = await getUserAiConfig(session.user.id);
    const apiKey = parsed.data.apiKey || existing?.apiKey;
    if (!apiKey) return { error: "请填写 API Key（或由部署者配置服务器 Key）" };
    const baseUrl = parsed.data.baseUrl || existing?.baseUrl || "";
    const model = parsed.data.model || existing?.model || "";
    await setUserAiConfig(session.user.id, { apiKey, baseUrl, model });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "已保存——AI 助手将使用你的配置。" };
}
