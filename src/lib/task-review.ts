import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  taskAnnotations,
  taskAssignees,
  taskDependencies,
  tasks,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { recordTaskActivity } from "./activity";
import { notifyReviewResult } from "./notify";

// 评审角色两级口径：
// - 初审（退回 + 批注）：admin/teacher/leader——小组长帮教师把明显不合格的挡回去
// - 终审（通过 → done）：仅 admin/teacher——评分权不下放
const REJECTER_ROLES = ["admin", "teacher", "leader"];
const FINAL_REVIEWER_ROLES = ["admin", "teacher"];

async function loadTask(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  return task;
}

// 学生（任务负责人）提交评审：doing → reviewing
export async function submitReview(actorId: string, taskId: string) {
  const task = await loadTask(taskId);
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();

  // 仅任务负责人可提交评审；教师/管理员/小组长（非负责人）亦可代为提交
  const assignees = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId));
  const isAssignee = assignees.some((a) => a.userId === actorId);
  if (!isAssignee && !FINAL_REVIEWER_ROLES.includes(access.role) && access.role !== "leader")
    throw new ForbiddenError();

  await transition(task, actorId, "reviewing");
}

// 教师终审通过：reviewing → done，附评审意见（写入批注表 kind=review）
export async function approveReview(actorId: string, taskId: string, comment?: string) {
  const task = await loadTask(taskId);
  await requireRole(actorId, task.projectId, FINAL_REVIEWER_ROLES);

  // 通过即完成，沿用 updateTask 的完成-开始依赖校验口径
  const blockers = await db
    .select({ title: tasks.title })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(and(eq(taskDependencies.successorId, taskId), ne(tasks.status, "done")));
  if (blockers.length > 0)
    throw new AppError(
      `存在未完成的前置任务（${blockers.map((b) => b.title).join("、")}），暂不能通过评审`,
    );

  await transition(task, actorId, "done", comment);
  if (comment && comment.trim()) {
    await db.insert(taskAnnotations).values({
      taskId,
      authorId: actorId,
      content: comment.trim(),
      kind: "review",
    });
  }
}

// 初审退回：reviewing → rejected，退回原因必填（写入批注表 kind=rejection）
// 小组长（leader）亦可退回——初审权下放，终审仍由教师把握
export async function rejectReview(actorId: string, taskId: string, reason: string) {
  const task = await loadTask(taskId);
  await requireRole(actorId, task.projectId, REJECTER_ROLES);
  if (!reason.trim()) throw new AppError("请填写退回原因");

  await transition(task, actorId, "rejected", reason);
  await db.insert(taskAnnotations).values({
    taskId,
    authorId: actorId,
    content: reason.trim(),
    kind: "rejection",
  });
}

// 学生修改后重提：rejected → reviewing
export async function resubmitReview(actorId: string, taskId: string) {
  const task = await loadTask(taskId);
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  await transition(task, actorId, "reviewing");
}

// 状态流转核心：校验起点状态 → 更新 → 活动留痕 → 通知负责人
async function transition(
  task: { id: string; status: TaskStatus; projectId: string; title: string },
  actorId: string,
  to: TaskStatus,
  note?: string,
) {
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    todo: [],
    doing: ["reviewing"],
    reviewing: ["done", "rejected"],
    rejected: ["reviewing"],
    done: [],
  };
  if (!allowed[task.status].includes(to))
    throw new AppError(`当前状态不允许该操作`);

  const [updated] = await db
    .update(tasks)
    .set({
      status: to,
      // 燃尽图按 completedAt 统计「当天结束时仍剩余的工作量」
      completedAt: to === "done" ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
    .returning();
  if (!updated) throw new AppError("任务状态已变化，请刷新后重试");

  await recordTaskActivity({
    taskId: task.id,
    userId: actorId,
    type: "status_changed",
    payload: { from: task.status, to },
  });

  // 评审结果通知全体负责人（评审人自己不收）
  if (to === "done" || to === "rejected") {
    const assignees = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, task.id));
    await notifyReviewResult(
      { ...updated, assigneeIds: assignees.map((a) => a.userId) },
      to === "done" ? "approved" : "rejected",
      actorId,
      note,
    );
  }
}

async function requireRole(actorId: string, projectId: string, roles: string[]) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (!roles.includes(access.role)) throw new ForbiddenError();
  return access;
}
