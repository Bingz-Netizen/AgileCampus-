import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  taskAnnotations,
  taskAssignees,
  taskDependencies,
  tasks,
  users,
  type AnnotationKind,
  type TaskStatus,
  type TeamRole,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { recordTaskActivity } from "./activity";
import { notifyReviewResult } from "./notify";

// ---- 第二阶段：批注评审 + 小组长 ----
// 状态机（只允许这些跃迁，其余一律拒绝）：
//   doing → review（负责人提交评审）
//   rejected → review（修改后重提）
//   review → done（教师/管理员终审通过）
//   review → rejected（教师/管理员/小组长退回修改）
// 终态约束：done 之后不能再退回；todo 不能直接提交评审。

const SUBMIT_ROLES: TeamRole[] = ["admin", "student", "leader"];
const APPROVE_ROLES: TeamRole[] = ["admin", "teacher"];
const REJECT_ROLES: TeamRole[] = ["admin", "teacher", "leader"];

export const REVIEW_STATUSES: TaskStatus[] = ["review", "rejected"];

type TaskContext = {
  task: {
    id: string;
    projectId: string;
    title: string;
    status: TaskStatus;
    priority: string;
    dueDate: string | null;
    completedAt: Date | null;
  };
  role: TeamRole;
  assigneeIds: string[];
  actorName: string;
  projectName: string;
};

async function loadTaskContext(actorId: string, taskId: string): Promise<TaskContext> {
  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();

  const assignees = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId));

  const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));

  return {
    task,
    role: access.role as TeamRole,
    assigneeIds: assignees.map((a) => a.userId),
    actorName: actor?.name ?? "评审人",
    projectName: access.project.name,
  };
}

async function moveTo(
  actorId: string,
  task: { id: string; status: TaskStatus; projectId: string },
  to: TaskStatus,
  payload: Record<string, unknown>,
) {
  const now = new Date();
  await db
    .update(tasks)
    .set({
      status: to,
      updatedAt: now,
      completedAt: to === "done" ? now : null,
    })
    .where(eq(tasks.id, task.id));
  await recordTaskActivity({
    taskId: task.id,
    userId: actorId,
    type: "status_changed",
    payload: { from: task.status, to, ...payload },
  });
}

function assertCanSubmit(ctx: TaskContext, actorId: string) {
  if (!SUBMIT_ROLES.includes(ctx.role)) throw new AppError("当前角色不能提交评审");
  if (!ctx.assigneeIds.includes(actorId)) throw new AppError("只有任务负责人才能提交评审");
  if (ctx.task.status !== "doing" && ctx.task.status !== "rejected") {
    throw new AppError(
      ctx.task.status === "review" ? "任务已在待评审中" : "只有「进行中」或「已退回」的任务可以提交评审",
    );
  }
}

/** 提交评审：负责人（学生/小组长/管理员）把进行中或已退回的任务送入待评审 */
export async function submitForReview(actorId: string, taskId: string) {
  const ctx = await loadTaskContext(actorId, taskId);
  assertCanSubmit(ctx, actorId);
  await moveTo(actorId, ctx.task, "review", { action: "submit_review" });
}

/** 终审通过：仅教师/管理员；存在未完成前置任务时拒绝（与完成-开始依赖口径一致） */
export async function approveReview(actorId: string, taskId: string, note?: string) {
  const ctx = await loadTaskContext(actorId, taskId);
  if (!APPROVE_ROLES.includes(ctx.role)) throw new AppError("只有教师或管理员可以终审通过");
  if (ctx.task.status !== "review") throw new AppError("只有「待评审」的任务可以通过评审");

  const blockers = await db
    .select({ title: tasks.title })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(and(eq(taskDependencies.successorId, taskId), ne(tasks.status, "done")));
  if (blockers.length > 0) {
    throw new AppError(
      `存在未完成的前置任务（${blockers.map((b) => b.title).join("、")}），暂不能通过评审`,
    );
  }

  await moveTo(actorId, ctx.task, "done", { action: "approve_review", reviewer: ctx.actorName });
  const content = (note ?? "").trim();
  if (content) {
    await db.insert(taskAnnotations).values({ taskId, authorId: actorId, kind: "review", content });
  }
  await notifyReviewResult(
    {
      id: ctx.task.id,
      title: ctx.task.title,
      projectId: ctx.task.projectId,

      dueDate: ctx.task.dueDate,
      priority: ctx.task.priority,
      assigneeIds: ctx.assigneeIds,
    },
    actorId,
    { passed: true, reviewer: ctx.actorName, opinion: content || "（无附加意见）" },
  );
  await notifyReviewInApp(taskId, ctx.task.projectId, actorId, ctx.assigneeIds);
}

/** 退回修改：教师/管理员/小组长；退回原因必填，自动写入批注并通知全体负责人 */
export async function rejectReview(actorId: string, taskId: string, reason: string) {
  const ctx = await loadTaskContext(actorId, taskId);
  if (!REJECT_ROLES.includes(ctx.role)) throw new AppError("当前角色不能退回评审");
  if (ctx.task.status !== "review") throw new AppError("只有「待评审」的任务可以退回");
  const content = (reason ?? "").trim();
  if (!content) throw new AppError("退回原因不能为空");

  await moveTo(actorId, ctx.task, "rejected", { action: "reject_review", reviewer: ctx.actorName });
  await db.insert(taskAnnotations).values({ taskId, authorId: actorId, kind: "reject", content });
  await notifyReviewResult(
    {
      id: ctx.task.id,
      title: ctx.task.title,
      projectId: ctx.task.projectId,

      dueDate: ctx.task.dueDate,
      priority: ctx.task.priority,
      assigneeIds: ctx.assigneeIds,
    },
    actorId,
    { passed: false, reviewer: ctx.actorName, opinion: content },
  );
  await notifyReviewInApp(taskId, ctx.task.projectId, actorId, ctx.assigneeIds);
}

// ---- 批注 ----

async function requireTaskMember(actorId: string, taskId: string) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return { task, access };
}

export async function addAnnotation(
  actorId: string,
  taskId: string,
  input: { content: string; parentId?: string },
) {
  const { task } = await requireTaskMember(actorId, taskId);
  const content = (input.content ?? "").trim();
  if (!content) throw new AppError("批注内容不能为空");

  if (input.parentId) {
    const [parent] = await db
      .select({ taskId: taskAnnotations.taskId })
      .from(taskAnnotations)
      .where(eq(taskAnnotations.id, input.parentId));
    if (!parent || parent.taskId !== task.id) throw new AppError("回复的批注不属于该任务");
  }

  const [row] = await db
    .insert(taskAnnotations)
    .values({
      taskId,
      authorId: actorId,
      parentId: input.parentId ?? null,
      kind: "comment",
      content,
    })
    .returning();
  return row;
}

export type AnnotationItem = {
  id: string;
  parentId: string | null;
  kind: AnnotationKind;
  content: string;
  createdAt: Date;
  authorName: string | null;
};

export async function listAnnotations(actorId: string, taskId: string): Promise<AnnotationItem[]> {
  await requireTaskMember(actorId, taskId);
  return db
    .select({
      id: taskAnnotations.id,
      parentId: taskAnnotations.parentId,
      kind: taskAnnotations.kind,
      content: taskAnnotations.content,
      createdAt: taskAnnotations.createdAt,
      authorName: users.name,
    })
    .from(taskAnnotations)
    .leftJoin(users, eq(taskAnnotations.authorId, users.id))
    .where(eq(taskAnnotations.taskId, taskId))
    .orderBy(asc(taskAnnotations.createdAt));
}

/** 站内评审通知：给全体负责人（评审人自己除外） */
export async function notifyReviewInApp(
  taskId: string,
  projectId: string,
  reviewerId: string,
  assigneeIds: string[],
) {
  const recipients = [...new Set(assigneeIds)].filter((id) => id !== reviewerId);
  if (recipients.length === 0) return;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      type: "review" as const,
      projectId,
      taskId,
    })),
  );
}
