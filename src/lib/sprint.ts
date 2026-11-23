import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  sprints,
  tasks,
  type SprintStatus,
  type TaskStatus,
} from "@/db/schema";
import { AppError } from "./errors";
import { getProjectForUser } from "./project";
import { requireTaskWrite } from "./task";

// 迭代（Sprint）是最后一周的收敛单位：任务挂到迭代上，燃尽图据此统计剩余工作量。
// 只接受 YYYY-MM-DD 字符串，日期运算全部在 UTC 里做，避免宿主机时区把「今天」算错。

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function eachDay(startDay: string, endDay: string): string[] {
  const start = parseDay(startDay);
  const end = parseDay(endDay);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [startDay];
  const days: string[] = [];
  const span = Math.min(Math.round((end - start) / DAY_MS), 366);
  for (let i = 0; i <= span; i++) days.push(formatDay(start + i * DAY_MS));
  return days;
}

export type BurndownTask = {
  estimateHours: number | null;
  completedAt: Date | string | null;
  status: TaskStatus;
};

export type BurndownPoint = {
  date: string;
  /** 理想剩余：按天数线性递减到 0 */
  ideal: number;
  /** 实际剩余：当天结束时仍未完成的任务工时之和；未来日期为 null */
  actual: number | null;
};

/**
 * 燃尽图数据：纯函数，便于单测。
 * - 总工作量 = 迭代内任务的 estimateHours 之和（未估时按 0 计）
 * - 实际剩余 = 总工作量 - 当天结束前已完成任务的工时（completedAt 取 UTC 日期）
 * - 未来日期 actual 为 null，只画到「今天」
 */
export function buildBurndown(
  sprint: { startDate: string | null; endDate: string | null },
  sprintTasks: BurndownTask[],
  today: string,
): BurndownPoint[] {
  const start = sprint.startDate ?? today;
  const end = sprint.endDate ?? sprint.startDate ?? today;
  const days = eachDay(start, end);
  const total = sprintTasks.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
  const dayMs = days.map(parseDay);
  const todayMs = parseDay(today);

  return days.map((date, i) => {
    const ideal = days.length > 1 ? (total * (days.length - 1 - i)) / (days.length - 1) : total;
    if (dayMs[i] > todayMs) return { date, ideal: Math.max(ideal, 0), actual: null };

    const endOfDay = dayMs[i] + DAY_MS - 1;
    const remaining = sprintTasks.reduce((sum, t) => {
      const doneAt = t.completedAt ? new Date(t.completedAt).getTime() : null;
      if (doneAt !== null && doneAt <= endOfDay) return sum;
      return sum + (t.estimateHours ?? 0);
    }, 0);
    return { date, ideal: Math.max(ideal, 0), actual: remaining };
  });
}

/** 燃尽图旁边的汇总数字 */
export function sprintSummary(sprintTasks: BurndownTask[]) {
  const total = sprintTasks.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
  const done = sprintTasks.filter((t) => t.status === "done").length;
  const remaining = sprintTasks.reduce(
    (sum, t) => sum + (t.status === "done" ? 0 : (t.estimateHours ?? 0)),
    0,
  );
  const unestimated = sprintTasks.filter((t) => t.estimateHours === null).length;
  return { total, done, remaining, count: sprintTasks.length, unestimated };
}

export type SprintRow = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  taskCount: number;
  doneCount: number;
  totalHours: number;
  remainingHours: number;
};

export async function listProjectSprints(actorId: string, projectId: string): Promise<SprintRow[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new AppError("项目不存在或无权访问");

  const rows = await db
    .select()
    .from(sprints)
    .where(eq(sprints.projectId, projectId))
    .orderBy(desc(sprints.createdAt));

  const allTasks = await db
    .select({
      sprintId: tasks.sprintId,
      status: tasks.status,
      estimateHours: tasks.estimateHours,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  return rows.map((s) => {
    const mine = allTasks.filter((t) => t.sprintId === s.id);
    const summary = sprintSummary(mine.map((t) => ({ ...t, completedAt: null })));
    return {
      id: s.id,
      name: s.name,
      goal: s.goal,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      taskCount: summary.count,
      doneCount: summary.done,
      totalHours: summary.total,
      remainingHours: summary.remaining,
    };
  });
}

export async function createSprint(
  actorId: string,
  projectId: string,
  input: { name: string; goal?: string; startDate?: string; endDate?: string },
) {
  await requireTaskWrite(actorId, projectId);
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new AppError("迭代结束日不能早于开始日");
  }
  const [sprint] = await db
    .insert(sprints)
    .values({
      projectId,
      name: input.name.trim(),
      goal: input.goal?.trim() || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
    })
    .returning();
  return sprint;
}

export async function closeSprint(actorId: string, sprintId: string) {
  const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId));
  if (!sprint) throw new AppError("迭代不存在");
  await requireTaskWrite(actorId, sprint.projectId);
  const [updated] = await db
    .update(sprints)
    .set({ status: "closed" })
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, sprint.projectId)))
    .returning();
  return updated;
}

/** 项目页/任务编辑用：取该项目所有迭代，供下拉选择 */
export async function listSprintOptions(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) return [];
  return db
    .select({
      id: sprints.id,
      name: sprints.name,
      status: sprints.status,
    })
    .from(sprints)
    .where(eq(sprints.projectId, projectId))
    .orderBy(desc(sprints.createdAt));
}

/** 批量归入迭代：迭代页「一键拉入未排期任务」用 */
export async function assignTasksToSprint(
  actorId: string,
  sprintId: string,
  taskIds: string[],
) {
  const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId));
  if (!sprint) throw new AppError("迭代不存在");
  await requireTaskWrite(actorId, sprint.projectId);
  if (taskIds.length === 0) return 0;

  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, sprint.projectId), inArray(tasks.id, taskIds)));
  if (rows.length !== taskIds.length) throw new AppError("存在不属于该项目的任务");

  const updated = await db
    .update(tasks)
    .set({ sprintId, updatedAt: sql`now()` })
    .where(inArray(tasks.id, taskIds))
    .returning({ id: tasks.id });
  return updated.length;
}

/** 迭代页用：列出尚未排入任何迭代的任务 */
export async function listUnassignedTasks(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) return [];
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      kind: tasks.kind,
      estimateHours: tasks.estimateHours,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.sprintId)))
    .orderBy(tasks.sortOrder);
}
