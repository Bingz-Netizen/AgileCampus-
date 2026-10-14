import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  labels,
  milestones,
  taskAssignees,
  taskDependencies,
  taskLabels,
  tasks,
  teamMembers,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getProjectForUser } from "./project";
import { notifyTaskAssigned, notifyTaskCompleted } from "./notify";
import { recordTaskActivity } from "./activity";

// 任务写操作角色：admin + student（teacher 只读，设计文档 §5）
const TASK_WRITE_ROLES = ["admin", "student"];

async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 供 lib/label.ts 复用：贴标签属任务写操作，权限口径须与 createTask/updateTask 一致
export async function requireTaskWrite(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (!TASK_WRITE_ROLES.includes(access.role)) throw new ForbiddenError();
  return access;
}

async function validateAssignees(teamId: string, assigneeIds: string[]) {
  if (assigneeIds.length === 0) return;
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, assigneeIds)));
  if (rows.length !== assigneeIds.length) throw new AppError("负责人不是团队成员");
}

async function validateMilestone(projectId: string, milestoneId: string) {
  const [m] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)));
  if (!m) throw new AppError("里程碑不属于该项目");
}

// 父任务须存在且同项目——防跨项目挂载
async function validateParentTask(projectId: string, parentTaskId: string) {
  const [p] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.projectId, projectId)));
  if (!p) throw new AppError("父任务不属于该项目");
}

export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeIds?: string[];
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
    parentTaskId?: string;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const access = await requireTaskWrite(actorId, projectId);
  const assigneeIds = [...new Set(input.assigneeIds ?? [])];
  await validateAssignees(access.project.teamId, assigneeIds);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);
  if (input.parentTaskId) await validateParentTask(projectId, input.parentTaskId);

  const [task] = await exec
    .insert(tasks)
    .values({
      projectId,
      createdById: actorId,
      title: input.title,
      description: input.description,
      startDate: input.startDate,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      parentTaskId: input.parentTaskId,
      priority: input.priority ?? "medium",
      sortOrder: Date.now(),
    })
    .returning();

  if (assigneeIds.length > 0) {
    await exec
      .insert(taskAssignees)
      .values(assigneeIds.map((userId) => ({ taskId: task.id, userId })));
  }

  const created = { ...task, assigneeIds };
  // 非事务路径：即时通知（fire-and-forget，通知内部已吞异常）。事务路径由调用方提交后补发。
  if (!opts?.tx) void notifyTaskAssigned(created);
  return created;
}

export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assigneeIds?: string[];
    startDate?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completionNote?: string | null;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const [task] = await exec.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);
  const oldAssigneeIds = (
    await exec
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
  ).map((r) => r.userId);
  const nextAssigneeIds = patch.assigneeIds === undefined ? oldAssigneeIds : [...new Set(patch.assigneeIds)];
  if (patch.assigneeIds !== undefined) await validateAssignees(access.project.teamId, nextAssigneeIds);
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);

  // 完成-开始依赖：标记 done 前校验无未完成的前置任务（后置任务被前置阻断，不得完成）。
  // 仅限「非 done → done」的跃迁，避免已完成任务补保存时被历史前置误拦。
  if (patch.status === "done" && task.status !== "done") {
    const blockers = await exec
      .select({ title: tasks.title })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
      .where(and(eq(taskDependencies.successorId, taskId), ne(tasks.status, "done")));
    if (blockers.length > 0)
      throw new AppError(
        `存在未完成的前置任务（${blockers.map((b) => b.title).join("、")}），暂不能标记完成`,
      );
  }

  // 显式白名单构造，勿用 ...patch 展开：运行时宽对象可夹带 projectId/sortOrder 等越权字段
  const [updated] = await exec
    .update(tasks)
    // updatedAt 取 DB 时钟（now()）而非宿主机 new Date()：与 createdAt 的 defaultNow() 同源，保证单调性
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.milestoneId !== undefined && { milestoneId: patch.milestoneId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  // 负责人集合变更：先删后插（仿 setTaskLabels）
  if (patch.assigneeIds !== undefined) {
    await exec.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
    if (nextAssigneeIds.length > 0) {
      await exec
        .insert(taskAssignees)
        .values(nextAssigneeIds.map((userId) => ({ taskId, userId })));
    }
  }

  // 状态变更留痕：任务时间线合并展示「状态变更」与评论（含事务内一并写入，回滚即撤）
  if (patch.status !== undefined && patch.status !== task.status) {
    await recordTaskActivity({
      taskId,
      userId: actorId,
      type: "status_changed",
      payload: { from: task.status, to: patch.status },
      tx: opts?.tx,
    });
  }

  const result = { ...updated, assigneeIds: nextAssigneeIds };
  if (!opts?.tx) {
    // 改派：仅通知「新增」的负责人（避免给已指派者重复轰炸）
    if (patch.assigneeIds !== undefined) {
      const added = nextAssigneeIds.filter((id) => !oldAssigneeIds.includes(id));
      if (added.length > 0) void notifyTaskAssigned(result, added);
    }
    // 完成：通知创建者(≠操作者)
    if (patch.status === "done" && task.status !== "done") void notifyTaskCompleted(result, actorId);
  }
  return result;
}

export async function deleteTask(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, task.projectId);
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export type TaskLabel = { id: string; name: string; color: string };

// 另发一次查询按 taskId 归并，不用 leftJoin：join 会造成行乘积，
// 污染既有 orderBy(sortOrder) 与调用方「一行一任务」的假设。
async function labelsByTask(taskIds: string[]): Promise<Map<string, TaskLabel[]>> {
  const map = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(labels.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}

export type TaskAssignee = { id: string; name: string };

// 负责人归并：与 labelsByTask 同理，避免 join 行乘积。按姓名排序。
async function assigneesByTask(taskIds: string[]): Promise<Map<string, TaskAssignee[]>> {
  const map = new Map<string, TaskAssignee[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({ taskId: taskAssignees.taskId, id: users.id, name: users.name })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(users.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.taskId, list);
  }
  return map;
}

// 给任务行挂上负责人三件套：assignees（对象列表）/ assigneeIds / assigneeNames（顿号拼接）
function attachAssignees<T extends { id: string }>(row: T, byTask: Map<string, TaskAssignee[]>) {
  const assignees = byTask.get(row.id) ?? [];
  return {
    ...row,
    assignees,
    assigneeIds: assignees.map((a) => a.id),
    assigneeNames: assignees.length > 0 ? assignees.map((a) => a.name).join("、") : null,
  };
}

export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      updatedAt: tasks.updatedAt,
      completionNote: tasks.completionNote,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);

  const ids = rows.map((r) => r.id);
  const [byLabel, byAssignee] = await Promise.all([labelsByTask(ids), assigneesByTask(ids)]);
  return rows.map((r) => ({
    ...attachAssignees(r, byAssignee),
    labels: byLabel.get(r.id) ?? [],
  }));
}

// 列某任务之下的子任务（直接子级，不递归）
export async function listSubtasks(actorId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, parent.projectId);

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      completionNote: tasks.completionNote,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(tasks.sortOrder);

  const byAssignee = await assigneesByTask(rows.map((r) => r.id));
  return rows.map((r) => attachAssignees(r, byAssignee));
}

// 在某任务下建子任务：projectId 由父任务推得，调用方无须再传。
// 新建行必无既有子级，故不可能成环，无须环检测。
export async function createSubtask(
  actorId: string,
  parentTaskId: string,
  input: {
    title: string;
    description?: string;
    assigneeIds?: string[];
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
  },
) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  return createTask(actorId, parent.projectId, { ...input, parentTaskId });
}

// 单任务详情（供 Agent API 按 id 直取）。权限口径同 listProjectTasks：项目成员即可读。
// 注：「任务不存在」先于权限返回，沿既有 updateTask/deleteTask 之口径（BACKLOG 已录此债）。
export async function getTaskDetail(actorId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      completionNote: tasks.completionNote,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      updatedAt: tasks.updatedAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!row) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, row.projectId);
  const [byLabel, byAssignee] = await Promise.all([labelsByTask([row.id]), assigneesByTask([row.id])]);
  return { ...attachAssignees(row, byAssignee), labels: byLabel.get(row.id) ?? [] };
}

// 沿既有依赖边（predecessor→successor）做 BFS：fromId 是否可「到达」toId。
// 若可达，则新增 fromId→toId 即成环。全项目规模小，逐层查库即可。
async function dependencyReaches(fromId: string, toId: string): Promise<boolean> {
  let frontier = [fromId];
  const visited = new Set<string>();
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (id === toId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      const rows = await db
        .select({ successorId: taskDependencies.successorId })
        .from(taskDependencies)
        .where(eq(taskDependencies.predecessorId, id));
      for (const r of rows) next.push(r.successorId);
    }
    frontier = next;
  }
  return false;
}

// 设置 predecessor 的后置任务（先删旧再插新）。防自指、防成环（含间接环）。
export async function setTaskSuccessors(
  actorId: string,
  predecessorId: string,
  successorIds: string[],
) {
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, pred.projectId);

  for (const sid of successorIds) {
    if (sid === predecessorId) throw new AppError("后置任务不可构成循环");
    const [s] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, sid));
    if (!s || s.projectId !== pred.projectId)
      throw new AppError("后置任务不属于该项目");
    // 防成环（含间接环）：若 sid 已可达 predecessor，则新增 predecessor→sid 成环
    if (await dependencyReaches(sid, predecessorId))
      throw new AppError("后置任务不可构成循环");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.predecessorId, predecessorId));
    if (successorIds.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(successorIds.map((sid) => ({ predecessorId, successorId: sid })));
    }
  });
}

// 新增一条完成-开始依赖：predecessor 未完成前，successor 不可完成（详情页「依赖」区块用）。
// 防自指、防重复、防成环（含间接环）；前置/后置须同项目。
export async function addTaskDependency(
  actorId: string,
  predecessorId: string,
  successorId: string,
) {
  if (predecessorId === successorId) throw new AppError("前置任务不可指向自身");
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("前置任务不存在");
  const [succ] = await db.select().from(tasks).where(eq(tasks.id, successorId));
  if (!succ) throw new AppError("后置任务不存在");
  if (pred.projectId !== succ.projectId)
    throw new AppError("前置任务须与后置任务同属一个项目");
  await requireTaskWrite(actorId, succ.projectId);

  // 若后置已可达前置（沿既有依赖），新增前置→后置即成环
  if (await dependencyReaches(successorId, predecessorId))
    throw new AppError("会形成循环依赖，禁止添加");

  try {
    await db.transaction(async (tx) => {
      await tx.insert(taskDependencies).values({ predecessorId, successorId });
      // 依赖变更留痕（记在后置任务上，时间线合并展示）
      await recordTaskActivity({
        taskId: successorId,
        userId: actorId,
        type: "dependency_added",
        payload: { predecessorId, predecessorTitle: pred.title },
        tx,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("该前置依赖已存在");
    throw e;
  }
}

// 删除一条前置依赖（详情页「依赖」区块用）。删除前由前端二次确认。
export async function removeTaskDependency(
  actorId: string,
  predecessorId: string,
  successorId: string,
) {
  const [succ] = await db.select().from(tasks).where(eq(tasks.id, successorId));
  if (!succ) throw new AppError("后置任务不存在");
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  const predecessorTitle = pred?.title ?? predecessorId;
  await requireTaskWrite(actorId, succ.projectId);
  await db.transaction(async (tx) => {
    await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, predecessorId),
          eq(taskDependencies.successorId, successorId),
        ),
      );
    // 依赖变更留痕（记在后置任务上，时间线合并展示）
    await recordTaskActivity({
      taskId: successorId,
      userId: actorId,
      type: "dependency_removed",
      payload: { predecessorId, predecessorTitle },
      tx,
    });
  });
}

export async function listProjectDependencies(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      predecessorId: taskDependencies.predecessorId,
      successorId: taskDependencies.successorId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(tasks.projectId, projectId));
}
