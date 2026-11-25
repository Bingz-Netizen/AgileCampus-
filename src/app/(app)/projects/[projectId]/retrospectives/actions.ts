"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createRetro, updateRetro, deleteRetro } from "@/lib/retro";
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

const updateSchema = schema.extend({ retroId: z.uuid() });

export async function updateRetroAction(
  _prev: RetroFormState,
  formData: FormData,
): Promise<RetroFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = updateSchema.safeParse({ ...raw, sprintId: raw.sprintId || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, retroId, ...input } = parsed.data;
  try {
    await updateRetro(session.user.id, retroId, input);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}/retrospectives`);
  return { ok: true };
}

const deleteSchema = z.object({ projectId: z.uuid(), retroId: z.uuid() });

export async function deleteRetroAction(
  _prev: RetroFormState,
  formData: FormData,
): Promise<RetroFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  const { projectId, retroId } = parsed.data;
  try {
    await deleteRetro(session.user.id, retroId);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}/retrospectives`);
  return { ok: true };
}
