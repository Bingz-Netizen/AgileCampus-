"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createRetro } from "@/lib/retro";
import { AppError } from "@/lib/errors";

export type RetroFormState = { error: string } | { ok: true } | null;

const schema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写复盘标题"),
  sprintId: z.uuid().optional(),
  wentWell: z.string().trim().optional(),
  wentBad: z.string().trim().optional(),
  improvements: z.string().trim().optional(),
  pitfalls: z.string().trim().optional(),
});

export async function createRetroAction(
  _prev: RetroFormState,
  formData: FormData,
): Promise<RetroFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse({ ...raw, sprintId: raw.sprintId || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    await createRetro(session.user.id, projectId, input);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}/retrospectives`);
  return { ok: true };
}
