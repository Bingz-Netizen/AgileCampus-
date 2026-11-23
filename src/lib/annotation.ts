import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskAnnotations, users, type TaskAnnotationKind } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

// 批注（第二阶段）：任务上的师生批注/评审意见/退回意见，支持双向回复。
// 权限口径：项目成员即可读写（师生双向），区别于任务写操作（teacher 只读）。

export type AnnotationDto = {
  id: string;
  parentId: string | null;
  content: string;
  kind: TaskAnnotationKind;
  authorId: string;
  authorName: string;
  createdAt: string;
};

async function requireMember(actorId: string, taskId: string) {
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 列出任务的全部批注（含回复），按时间正序；前端按 parentId 组树
export async function listAnnotations(actorId: string, taskId: string) {
  await requireMember(actorId, taskId);
  const rows = await db
    .select({
      id: taskAnnotations.id,
      parentId: taskAnnotations.parentId,
      content: taskAnnotations.content,
      kind: taskAnnotations.kind,
      authorId: taskAnnotations.authorId,
      authorName: users.name,
      createdAt: taskAnnotations.createdAt,
    })
    .from(taskAnnotations)
    .innerJoin(users, eq(users.id, taskAnnotations.authorId))
    .where(eq(taskAnnotations.taskId, taskId))
    .orderBy(asc(taskAnnotations.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

// 新增批注 / 回复既有批注。回复须属同一任务，防跨任务挂载。
export async function addAnnotation(
  actorId: string,
  taskId: string,
  input: { content: string; kind?: TaskAnnotationKind; parentId?: string },
) {
  const content = input.content.trim();
  if (!content) throw new AppError("批注内容不可为空");
  await requireMember(actorId, taskId);

  if (input.parentId) {
    const [parent] = await db
      .select({ taskId: taskAnnotations.taskId })
      .from(taskAnnotations)
      .where(and(eq(taskAnnotations.id, input.parentId), eq(taskAnnotations.taskId, taskId)));
    if (!parent) throw new AppError("被回复的批注不存在");
  }

  const [row] = await db
    .insert(taskAnnotations)
    .values({
      taskId,
      authorId: actorId,
      content,
      kind: input.kind ?? "comment",
      parentId: input.parentId,
    })
    .returning();
  return row;
}
