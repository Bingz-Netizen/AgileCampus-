"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  approveReview,
  rejectReview,
  resubmitReview,
  submitReview,
} from "@/lib/task-review";
import { AppError, ForbiddenError } from "@/lib/errors";

// 批注评审（第二阶段）server actions。批注的增删走 /api/tasks/:id/annotations，
// 此处只收评审流转四个动作（表单提交，useActionState 用）。

export type FormState = { error: string } | null;

const reviewSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});

async function runReview(
  formData: FormData,
  act: (actorId: string, taskId: string) => Promise<void>,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await act(session.user.id, parsed.data.taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限执行该操作" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// 学生：doing → reviewing（提交评审）
export async function submitReviewAction(_prev: FormState, formData: FormData) {
  return runReview(formData, submitReview);
}

// 学生：rejected → reviewing（修改后重提）
export async function resubmitReviewAction(_prev: FormState, formData: FormData) {
  return runReview(formData, resubmitReview);
}

// 教师：reviewing → done（通过，附评审意见）
export async function approveReviewAction(_prev: FormState, formData: FormData) {
  return runReview(formData, (actorId, taskId) =>
    approveReview(actorId, taskId, String(formData.get("comment") ?? "").trim() || undefined),
  );
}

// 教师：reviewing → rejected（退回，附退回原因，必填）
export async function rejectReviewAction(_prev: FormState, formData: FormData) {
  return runReview(formData, (actorId, taskId) =>
    rejectReview(actorId, taskId, String(formData.get("reason") ?? "")),
  );
}
