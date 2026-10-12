import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  projects,
  taskActivities,
  taskComments,
  tasks,
  users,
  type CommentAttachment,
  type TaskCommentKind,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listTeamMembers } from "./team";

// 评论/讨论属「协作留痕」：全体项目成员（含 teacher）皆可读可写，非任务写操作。
// 权限口径区别于 requireTaskWrite（admin+student），这里仅要求项目成员。

async function requireTaskMemberAccess(actorId: string, taskId: string) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return { task, access };
}

// 校验 mentions 均为该团队成员（去重；排除操作者自身在通知阶段处理）
async function assertMentionsInTeam(teamId: string, mentionIds: string[]) {
  if (mentionIds.length === 0) return;
  const members = await listTeamMembers(teamId);
  const memberIds = new Set(members.map((m) => m.id));
  for (const id of mentionIds) {
    if (!memberIds.has(id)) throw new AppError("提及的成员不在团队中");
  }
}

// 被 @ 成员收到站内红点提醒（通知失败不阻断评论主流程，故不抛）
async function notifyMentions(
  actorId: string,
  task: { id: string; projectId: string },
  commentId: string,
  mentionIds: string[],
) {
  const recipients = [...new Set(mentionIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;
  try {
    await db.insert(notifications).values(
      recipients.map((userId) => ({
        userId,
        type: "mention" as const,
        projectId: task.projectId,
        taskId: task.id,
        commentId,
      })),
    );
  } catch (e) {
    console.error("[comment] 写入提及通知失败", e);
  }
}

export async function createComment(
  actorId: string,
  taskId: string,
  input: {
    content: string;
    parentId?: string;
    mentions?: string[];
    attachments?: CommentAttachment[];
  },
) {
  const { task, access } = await requireTaskMemberAccess(actorId, taskId);

  // 回复的父评论须同属本任务——杜绝跨任务挂回复
  if (input.parentId) {
    const [parent] = await db
      .select({ taskId: taskComments.taskId })
      .from(taskComments)
      .where(eq(taskComments.id, input.parentId));
    if (!parent || parent.taskId !== taskId) throw new AppError("回复的评论不属于该任务");
  }

  const mentionIds = [...new Set(input.mentions ?? [])];
  await assertMentionsInTeam(access.project.teamId, mentionIds);

  const [comment] = await db
    .insert(taskComments)
    .values({
      taskId,
      userId: actorId,
      content: input.content,
      parentId: input.parentId,
      mentions: mentionIds,
      attachments: input.attachments ?? [],
    })
    .returning();

  await notifyMentions(actorId, task, comment.id, mentionIds);
  return comment;
}

// 标记 / 取消标记「决策/问题/交付」，即归档进项目档案。全体项目成员可操作。
export async function markCommentKind(
  actorId: string,
  commentId: string,
  kind: TaskCommentKind | null,
) {
  const [comment] = await db
    .select({ id: taskComments.id, taskId: taskComments.taskId })
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  if (!comment) throw new AppError("评论不存在");
  await requireTaskMemberAccess(actorId, comment.taskId);

  const [updated] = await db
    .update(taskComments)
    .set({ kind })
    .where(eq(taskComments.id, commentId))
    .returning();
  return updated;
}

export type CommentDto = {
  id: string;
  taskId: string;
  userId: string;
  authorName: string | null;
  parentId: string | null;
  content: string;
  mentions: string[];
  attachments: CommentAttachment[];
  kind: TaskCommentKind | null;
  createdAt: Date;
};

export async function listTaskComments(actorId: string, taskId: string): Promise<CommentDto[]> {
  await requireTaskMemberAccess(actorId, taskId);
  return db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      authorName: users.name,
      parentId: taskComments.parentId,
      content: taskComments.content,
      mentions: taskComments.mentions,
      attachments: taskComments.attachments,
      kind: taskComments.kind,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
}

export type ActivityDto = {
  id: string;
  type: "status_changed" | "dependency_added" | "dependency_removed";
  payload: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
};

export async function listTaskActivities(actorId: string, taskId: string): Promise<ActivityDto[]> {
  await requireTaskMemberAccess(actorId, taskId);
  return db
    .select({
      id: taskActivities.id,
      type: taskActivities.type,
      payload: taskActivities.payload,
      createdAt: taskActivities.createdAt,
      actorName: users.name,
    })
    .from(taskActivities)
    .innerJoin(users, eq(taskActivities.userId, users.id))
    .where(eq(taskActivities.taskId, taskId))
    .orderBy(asc(taskActivities.createdAt));
}

// 看板卡片评论气泡计数：按 taskId 聚合，仅统计本项目任务（防跨项目行污染）
export async function countProjectTaskComments(
  actorId: string,
  projectId: string,
): Promise<Record<string, number>> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const rows = await db
    .select({ taskId: taskComments.taskId, count: sql<number>`count(*)::int` })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .where(eq(tasks.projectId, projectId))
    .groupBy(taskComments.taskId);

  const map: Record<string, number> = {};
  for (const r of rows) map[r.taskId] = r.count;
  return map;
}

// 项目档案：被标记「决策/问题/交付」的评论，按时间倒序
export async function listProjectArchives(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      taskTitle: tasks.title,
      content: taskComments.content,
      kind: taskComments.kind,
      authorName: users.name,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(and(eq(tasks.projectId, projectId), isNotNull(taskComments.kind)))
    .orderBy(desc(taskComments.createdAt));
}

// 通知页读取：项目名 / 任务标题 / 评论者 / 评论内容（列表项展示）
export async function listMyMentionNotifications(actorId: string) {
  return db
    .select({
      id: notifications.id,
      projectId: notifications.projectId,
      taskId: notifications.taskId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      taskTitle: tasks.title,
      projectName: projects.name,
      commenterName: users.name,
      commentContent: taskComments.content,
    })
    .from(notifications)
    .innerJoin(tasks, eq(notifications.taskId, tasks.id))
    .innerJoin(projects, eq(notifications.projectId, projects.id))
    .innerJoin(taskComments, eq(notifications.commentId, taskComments.id))
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(eq(notifications.userId, actorId))
    .orderBy(desc(notifications.createdAt));
}

export async function countUnreadNotifications(actorId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actorId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function markNotificationRead(actorId: string, notificationId: string) {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, actorId),
        isNull(notifications.readAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function markAllNotificationsRead(actorId: string) {
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, actorId), isNull(notifications.readAt)));
}
