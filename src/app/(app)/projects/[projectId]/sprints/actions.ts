"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { closeSprint, createSprint, assignTasksToSprint } from "@/lib/sprint";
import { AppError, ForbiddenError } from "@/lib/errors";

export type SprintFormState = { error: string } | { ok: true; message?: string } | null;

const createSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "请填写迭代名称"),
  goal: z.string().trim().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  endDate: z.iso.date("日期格式不正确").optional(),
});

export async function createSprintAction(
  _prev: SprintFormState,
  formData: FormData,
): Promise<SprintFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createSchema.safeParse({
    ...raw,
    startDate: raw.startDate || undefined,
    endDate: raw.endDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    await createSprint(session.user.id, projectId, input);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建迭代" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}/sprints`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const closeSchema = z.object({ projectId: z.uuid(), sprintId: z.uuid() });

export async function closeSprintAction(
  _prev: SprintFormState,
  formData: FormData,
): Promise<SprintFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = closeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await closeSprint(session.user.id, parsed.data.sprintId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限关闭迭代" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}/sprints`);
  return { ok: true };
}

const assignSchema = z.object({
  projectId: z.uuid(),
  sprintId: z.uuid(),
  taskIds: z.array(z.uuid()).min(1, "至少勾选一个任务"),
});

// 迭代页「把未排期任务拉进本迭代」：一次提交整批 taskId
export async function assignTasksAction(input: {
  projectId: string;
  sprintId: string;
  taskIds: string[];
}): Promise<SprintFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const count = await assignTasksToSprint(
      session.user.id,
      parsed.data.sprintId,
      parsed.data.taskIds,
    );
    revalidatePath(`/projects/${parsed.data.projectId}/sprints`);
    revalidatePath(`/projects/${parsed.data.projectId}`);
    return { ok: true, message: `已加入 ${count} 个任务` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改迭代" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}
