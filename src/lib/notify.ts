import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users, projects, taskAssignees } from "@/db/schema";
import { sendCardMessage } from "./feishu";
import {
  buildAssignedCard,
  buildCompletedCard,
  buildDueReminderCard,
  type CardTask,
  type ReminderItem,
} from "./feishu-card";

// notify 收的 task 来自 createTask/updateTask 返回 row，含 projectId/priority/assigneeIds
type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeIds: string[];
  projectId: string;
  priority: string;
  completionNote?: string | null;
  createdById?: string | null;
};

// 取用户 open_id（未绑返回 null）
async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 补查卡片所需的 项目名 / 负责人名（多人顿号拼接）
async function enrich(task: TaskRow): Promise<CardTask> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId));
  let assigneeName: string | null = null;
  if (task.assigneeIds.length > 0) {
    const rows = await db
      .select({ name: users.name })
      .from(users)
      .where(inArray(users.id, task.assigneeIds));
    assigneeName = rows.map((r) => r.name).join("、") || null;
  }
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: proj?.name ?? "（未知项目）",
    assigneeName,
    dueDate: task.dueDate,
    priority: task.priority,
    completionNote: task.completionNote ?? null,
  };
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget，通知不得阻断主业务）
async function safeSend(openId: string, card: unknown): Promise<boolean> {
  try {
    await sendCardMessage(openId, card);
    return true;
  } catch (e) {
    console.error("[notify] 飞书发送失败", e);
    return false;
  }
}

export async function notifyTaskAssigned(
  task: TaskRow,
  recipients: string[] = task.assigneeIds,
): Promise<void> {
  // 卡片已含全部负责人名，此处仅决定发给谁：默认全体，改派时只发新增者
  const card = buildAssignedCard(await enrich(task));
  for (const userId of recipients) {
    const openId = await openIdOf(userId);
    if (!openId) continue;
    await safeSend(openId, card);
  }
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildCompletedCard(await enrich(task)));
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为一封卡片日报。返回发送人数与扫描任务数。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  // 临期/逾期：status≠done 且 dueDate ≤ 明日（含逾期），且负责人已绑飞书。
  // 走 task_assignees 连接表：一任务多负责人时拆多行，各收各的。
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      userId: taskAssignees.userId,
      projectId: tasks.projectId,
      openId: users.feishuOpenId,
    })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        isNotNull(users.feishuOpenId),
        // dueDate <= 明日（date 列与 CURRENT_DATE 比较）
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

  // 按负责人聚合
  const byUser = new Map<string, { openId: string; overdue: ReminderItem[]; dueSoon: ReminderItem[] }>();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    if (!r.userId || !r.openId) continue;
    const bucket = byUser.get(r.userId) ?? { openId: r.openId, overdue: [], dueSoon: [] };
    const item: ReminderItem = { id: r.id, title: r.title, projectId: r.projectId };
    if (r.dueDate && r.dueDate < todayStr) bucket.overdue.push(item);
    else bucket.dueSoon.push(item);
    byUser.set(r.userId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const ok = await safeSend(openId, buildDueReminderCard({ overdue, dueSoon }));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
