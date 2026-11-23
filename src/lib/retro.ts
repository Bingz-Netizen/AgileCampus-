import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { retrospectives, sprints, users } from "@/db/schema";
import { AppError } from "./errors";
import { getProjectForUser } from "./project";

// 迭代复盘：D7 小组复盘会留档。团队成员（含 teacher）都可记录——复盘本就是全员活动。

export async function createRetro(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    sprintId?: string;
    wentWell?: string;
    wentBad?: string;
    improvements?: string;
    pitfalls?: string;
  },
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new AppError("项目不存在或无权访问");

  if (input.sprintId) {
    const [s] = await db
      .select({ id: sprints.id })
      .from(sprints)
      .where(eq(sprints.id, input.sprintId));
    if (!s) throw new AppError("迭代不存在");
  }

  const [retro] = await db
    .insert(retrospectives)
    .values({
      projectId,
      sprintId: input.sprintId || null,
      title: input.title.trim(),
      wentWell: input.wentWell?.trim() || null,
      wentBad: input.wentBad?.trim() || null,
      improvements: input.improvements?.trim() || null,
      pitfalls: input.pitfalls?.trim() || null,
      createdById: actorId,
    })
    .returning();
  return retro;
}

export async function listRetros(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new AppError("项目不存在或无权访问");

  return db
    .select({
      id: retrospectives.id,
      title: retrospectives.title,
      wentWell: retrospectives.wentWell,
      wentBad: retrospectives.wentBad,
      improvements: retrospectives.improvements,
      pitfalls: retrospectives.pitfalls,
      createdAt: retrospectives.createdAt,
      sprintName: sprints.name,
      authorName: users.name,
    })
    .from(retrospectives)
    .leftJoin(sprints, eq(retrospectives.sprintId, sprints.id))
    .leftJoin(users, eq(retrospectives.createdById, users.id))
    .where(eq(retrospectives.projectId, projectId))
    .orderBy(desc(retrospectives.createdAt));
}
