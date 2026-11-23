"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { addAnnotation, approveReview, rejectReview, submitForReview } from "@/lib/review";
import { AppError, ForbiddenError } from "@/lib/errors";

export type ReviewState = { error: string } | { ok: true } | null;

const baseSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});

function fail(e: unknown): ReviewState {
  if (e instanceof ForbiddenError) return { error: "没有权限执行该操作" };
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

export async function submitReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = baseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };
  try {
    await submitForReview(session.user.id, parsed.data.taskId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

const approveSchema = baseSchema.extend({ note: z.string().trim().optional() });

export async function approveReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = approveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };
  try {
    await approveReview(session.user.id, parsed.data.taskId, parsed.data.note);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

const rejectSchema = baseSchema.extend({ reason: z.string().trim().min(1, "请填写退回原因") });

export async function rejectReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const parsed = rejectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rejectReview(session.user.id, parsed.data.taskId, parsed.data.reason);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

const annotationSchema = baseSchema.extend({
  content: z.string().trim().min(1, "批注内容不能为空"),
  parentId: z.uuid().optional(),
});

export async function addAnnotationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  const raw = Object.fromEntries(formData);
  const parsed = annotationSchema.safeParse({
    ...raw,
    parentId: raw.parentId || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await addAnnotation(session.user.id, parsed.data.taskId, {
      content: parsed.data.content,
      parentId: parsed.data.parentId,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
