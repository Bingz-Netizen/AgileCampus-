import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  commentEdits,
  notifications,
  projects,
  taskActivities,
  taskComments,
  tasks,
  users,
  type CommentAttachment,
  type CommentImportanceType,
  type TaskActivityType,
  type TaskCommentKind,
  type TeamRole,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listTeamMembers } from "./team";
import { recordTaskActivity } from "./activity";

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

// ---- 评论权限口径（任务评论讨论区）----
// 重要标记：仅 admin/teacher 可改（student 即使自己的评论也不可标记/取消）。
export function canMarkImportant(role: TeamRole): boolean {
  return role === "admin" || role === "teacher";
}

// 编辑：仅作者可编辑自己的评论（admin/teacher 亦不代改，避免篡改讨论记录）。
export function canEditComment(actorId: string, comment: { userId: string }): boolean {
  return actorId === comment.userId;
}

// 删除：作者删己，admin/teacher 可删任何，student 不可删他人。
export function canDeleteComment(
  actorId: string,
  role: TeamRole,
  comment: { userId: string },
): boolean {
  return actorId === comment.userId || role === "admin" || role === "teacher";
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

// 标记 / 取消标记「重要评论」（类型 decision/issue/delivery/reference）。仅 admin/teacher。
export async function markCommentImportant(
  actorId: string,
  commentId: string,
  input: { important: boolean; type?: CommentImportanceType },
) {
  const [comment] = await db
    .select({ id: taskComments.id, taskId: taskComments.taskId })
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  if (!comment) throw new AppError("评论不存在");

  const { access } = await requireTaskMemberAccess(actorId, comment.taskId);
  if (!canMarkImportant(access.role)) {
    throw new ForbiddenError("仅教师或管理员可标记重要评论");
  }
  if (input.important && !input.type) {
    throw new AppError("请选择重要评论类型");
  }

  const [updated] = await db
    .update(taskComments)
    .set(
      input.important
        ? {
            isImportant: true,
            importanceType: input.type ?? null,
            importantBy: actorId,
            importantAt: new Date(),
          }
        : {
            isImportant: false,
            importanceType: null,
            importantBy: null,
            importantAt: null,
          },
    )
    .where(eq(taskComments.id, commentId))
    .returning();
  return updated;
}

// 编辑评论：仅作者。旧文进 comment_edits 历史，editCount +1、记 editedAt。
export async function editComment(actorId: string, commentId: string, content: string) {
  const [comment] = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  if (!comment) throw new AppError("评论不存在");

  await requireTaskMemberAccess(actorId, comment.taskId);
  if (!canEditComment(actorId, comment)) {
    throw new ForbiddenError("仅评论作者可编辑自己的评论");
  }
  if (comment.deletedAt) throw new AppError("评论已删除");
  if (comment.content === content) return comment;

  await db.transaction(async (tx) => {
    await tx.insert(commentEdits).values({
      commentId,
      editorId: actorId,
      oldContent: comment.content,
      newContent: content,
    });
    await tx
      .update(taskComments)
      .set({ content, editedAt: new Date(), editCount: comment.editCount + 1 })
      .where(eq(taskComments.id, commentId));
  });

  const [updated] = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  return updated;
}

// 软删除评论：作者或 admin/teacher。删除重要评论时写入活动日志。
export async function deleteComment(actorId: string, commentId: string) {
  const [comment] = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      isImportant: taskComments.isImportant,
      deletedAt: taskComments.deletedAt,
    })
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  if (!comment) throw new AppError("评论不存在");

  const { access } = await requireTaskMemberAccess(actorId, comment.taskId);
  if (!canDeleteComment(actorId, access.role, comment)) {
    throw new ForbiddenError("无权删除该评论");
  }
  if (comment.deletedAt) return comment; // 幂等：已删除直接返回

  const [updated] = await db
    .update(taskComments)
    .set({ deletedAt: new Date(), deletedBy: actorId })
    .where(eq(taskComments.id, commentId))
    .returning();

  // admin/teacher 删除重要评论须留痕（作者删己的普通评论不额外记活动）
  if (comment.isImportant) {
    await recordTaskActivity({
      taskId: comment.taskId,
      userId: actorId,
      type: "comment_deleted",
      payload: { commentId: comment.id, important: true },
    });
  }
  return updated;
}

// 编辑历史：作者或 admin/teacher 可查看（旧文 → 新文、编辑人、编辑时间）
export async function listCommentHistory(actorId: string, commentId: string) {
  const [comment] = await db
    .select({ id: taskComments.id, taskId: taskComments.taskId, userId: taskComments.userId })
    .from(taskComments)
    .where(eq(taskComments.id, commentId));
  if (!comment) throw new AppError("评论不存在");

  const { access } = await requireTaskMemberAccess(actorId, comment.taskId);
  if (comment.userId !== actorId && !canMarkImportant(access.role)) {
    throw new ForbiddenError("无权查看该评论的编辑历史");
  }

  return db
    .select({
      id: commentEdits.id,
      oldContent: commentEdits.oldContent,
      newContent: commentEdits.newContent,
      editorName: users.name,
      createdAt: commentEdits.createdAt,
    })
    .from(commentEdits)
    .leftJoin(users, eq(commentEdits.editorId, users.id))
    .where(eq(commentEdits.commentId, commentId))
    .orderBy(asc(commentEdits.createdAt));
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
  isImportant: boolean;
  importanceType: CommentImportanceType | null;
  editedAt: Date | null;
  editCount: number;
  deletedAt: Date | null;
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
      isImportant: taskComments.isImportant,
      importanceType: taskComments.importanceType,
      editedAt: taskComments.editedAt,
      editCount: taskComments.editCount,
      deletedAt: taskComments.deletedAt,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
}

export type ActivityDto = {
  id: string;
  type: TaskActivityType;
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

// 项目档案：重要评论中「决策 / 交付」自动归档；旧 kind 标记（决策/问题/交付）保留兼容。
// 软删除的评论仍保留在档案中（删除记录不参与「重要」筛选，但档案保留）。
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
      importanceType: taskComments.importanceType,
      isImportant: taskComments.isImportant,
      deletedAt: taskComments.deletedAt,
      authorName: users.name,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(
      and(
        eq(tasks.projectId, projectId),
        or(
          isNotNull(taskComments.kind),
          inArray(taskComments.importanceType, ["decision", "delivery"]),
        ),
      ),
    )
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
    // 未读优先（read_at 为空的排前），组内按创建时间倒序（最新在前）
    .orderBy(
      sql`(${notifications.readAt} is null) desc`,
      desc(notifications.createdAt),
    );
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
