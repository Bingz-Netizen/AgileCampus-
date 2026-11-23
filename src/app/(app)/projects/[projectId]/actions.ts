"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createTask,
  updateTask,
  deleteTask,
  addTaskDependency,
  removeTaskDependency,
  reorderTask,
} from "@/lib/task";
import { setTaskLabels } from "@/lib/label";
import { createMilestone } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;
// 更新任务专用：成功回 { ok: true }，供编辑弹窗据以自闭
export type UpdateTaskState = { error: string } | { ok: true } | null;

const createTaskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写任务标题"),
  description: z.string().trim().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  // 最后一周：类型 / 估时 / 迭代 / 缺陷严重级
  kind: z.enum(["feature", "bug"]).optional(),
  estimateHours: z.coerce.number().positive("预估工时须大于 0").max(1000).optional(),
  sprintId: z.uuid().optional(),
  bugSeverity: z.enum(["blocker", "major", "minor"]).optional(),
});

export async function createTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createTaskSchema.safeParse({
    ...raw,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
    milestoneId: raw.milestoneId || undefined,
    priority: raw.priority || undefined,
    kind: raw.kind || undefined,
    estimateHours: raw.estimateHours || undefined,
    sprintId: raw.sprintId || undefined,
    bugSeverity: raw.bugSeverity || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const assigneeIds = formData
    .getAll("assigneeIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  const { projectId, ...input } = parsed.data;
  try {
    await createTask(session.user.id, projectId, { ...input, assigneeIds });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}

const createMilestoneSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写里程碑标题"),
  targetDate: z.iso.date("日期格式不正确").optional(),
});

export async function createMilestoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createMilestoneSchema.safeParse({
    ...raw,
    targetDate: raw.targetDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createMilestone(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      targetDate: parsed.data.targetDate,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建里程碑" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// 拖拽可改的字段白名单。校验与授权仍全数落在 updateTask
//（指派人须属团队、里程碑须属项目），故此处只做形状校验。
const movePatchSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeIds: z.array(z.uuid()).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  milestoneId: z.uuid().nullable().optional(),
  bugStatus: z.enum(["open", "fixing", "fixed", "verified"]).nullable().optional(),
});

const moveTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  patch: movePatchSchema,
});

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  patch: z.infer<typeof movePatchSchema>;
}): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "参数无效" };
  // 空补丁无事可做，视为非法请求
  if (Object.keys(parsed.data.patch).length === 0) return { error: "参数无效" };

  try {
    await updateTask(session.user.id, parsed.data.taskId, parsed.data.patch);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const updateTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1, "标题不可为空"),
  description: z.string().trim().optional(),
  milestoneId: z.uuid().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  priority: z.enum(["low", "medium", "high"]),
  completionNote: z.string().trim().optional(),
  // 最后一周新增
  sprintId: z.uuid().optional(),
  kind: z.enum(["feature", "bug"]),
  bugSeverity: z.enum(["blocker", "major", "minor"]).optional(),
  bugStatus: z.enum(["open", "fixing", "fixed", "verified"]).optional(),
  relatedTaskId: z.uuid().optional(),
  estimateHours: z.coerce.number().positive("预估工时须大于 0").max(1000).optional(),
  blocked: z.enum(["on"]).optional(),
  blockedReason: z.string().trim().optional(),
});

export async function updateTaskAction(
  _prev: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = updateTaskSchema.safeParse({
    ...raw,
    milestoneId: raw.milestoneId || undefined,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
    sprintId: raw.sprintId || undefined,
    bugSeverity: raw.bugSeverity || undefined,
    bugStatus: raw.bugStatus || undefined,
    relatedTaskId: raw.relatedTaskId || undefined,
    estimateHours: raw.estimateHours || undefined,
    blocked: raw.blocked || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, projectId, ...patch } = parsed.data;
  const labelIds = formData
    .getAll("labelIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const assigneeIds = formData
    .getAll("assigneeIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  try {
    await updateTask(session.user.id, taskId, {
      title: patch.title,
      description: patch.description ?? null,
      assigneeIds,
      milestoneId: patch.milestoneId ?? null,
      startDate: patch.startDate ?? null,
      dueDate: patch.dueDate ?? null,
      priority: patch.priority,
      completionNote: patch.completionNote ?? null,
      sprintId: patch.sprintId ?? null,
      kind: patch.kind,
      bugSeverity: patch.kind === "bug" ? (patch.bugSeverity ?? null) : null,
      bugStatus: patch.kind === "bug" ? (patch.bugStatus ?? "open") : null,
      relatedTaskId: patch.kind === "bug" ? (patch.relatedTaskId ?? null) : null,
      estimateHours: patch.estimateHours ?? null,
      blocked: patch.blocked === "on",
      blockedReason: patch.blockedReason ?? null,
    });
    await setTaskLabels(session.user.id, taskId, labelIds);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const reorderSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  direction: z.enum(["up", "down"]),
});

// 列内排序：看板卡片上的 ↑/↓（服务端 action，成功后刷新项目页）
export async function reorderTaskAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  const parsed = reorderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  try {
    await reorderTask(session.user.id, parsed.data.taskId, parsed.data.direction);
  } catch {
    // 排序失败不阻断页面：静默返回，刷新后仍是原顺序
    return;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
}

const deleteTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});
export async function deleteTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteTask(session.user.id, parsed.data.taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// 依赖（前置任务）增删：taskId 为后置任务（当前编辑的任务），predecessorId 为前置任务。
const dependencySchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  predecessorId: z.uuid(),
});

export async function addDependencyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = dependencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  const { taskId, projectId, predecessorId } = parsed.data;
  try {
    await addTaskDependency(session.user.id, predecessorId, taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改依赖" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}

export async function removeDependencyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = dependencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  const { taskId, projectId, predecessorId } = parsed.data;
  try {
    await removeTaskDependency(session.user.id, predecessorId, taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改依赖" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}
