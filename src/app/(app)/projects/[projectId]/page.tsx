import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { countProjectTaskComments } from "@/lib/comment";
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { computeMemberLoad } from "@/lib/member-load";
import { listSprintOptions } from "@/lib/sprint";
import { parseView } from "./view-nav";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { Board } from "./board";
import { ListView } from "./list-view";
import { GanttView } from "./gantt-view";
import { ViewTabs } from "./view-tabs";
import { EmptyState } from "./empty-state";
import { FilterBar } from "./filter-bar";
import { MemberLoadView } from "./member-load-view";
import { TaskDetail, type TaskDetailTask } from "./task-detail";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [projectMilestones, projectTasks, members, dependencies, teamLabels, commentCounts, sprintOptions] =
    await Promise.all([
      listProjectMilestones(session.user.id, projectId),
      listProjectTasks(session.user.id, projectId),
      listTeamMembers(project.teamId),
      listProjectDependencies(session.user.id, projectId),
      listTeamLabels(session.user.id, project.teamId),
      countProjectTaskComments(session.user.id, projectId),
      listSprintOptions(session.user.id, projectId),
    ]);

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 三视图切换：?view=kanban|list|gantt，非法或缺省回落看板
  const view = parseView(sp.view);
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const today = new Date().toLocaleDateString("sv-SE");
  const visibleTasks = applyFilters(projectTasks, filters, today);
  // 成员负载：纯函数聚合（含未完成/逾期/相对负载），供团队首页顶部仪表
  const memberLoads = computeMemberLoad(members, projectTasks, today);

  const canWrite = role === "admin" || role === "student" || role === "leader";
  const isAdmin = role === "admin";

  // 看板/列表共用同一份精简任务形状；甘特只需排期相关字段
  const boardTasks = visibleTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    completionNote: t.completionNote,
    status: t.status,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    assigneeIds: t.assigneeIds,
    assigneeNames: t.assigneeNames,
    milestoneId: t.milestoneId,
    labels: t.labels,
    commentCount: commentCounts[t.id] ?? 0,
    kind: t.kind,
    bugSeverity: t.bugSeverity,
    bugStatus: t.bugStatus,
    blocked: t.blocked,
    sortOrder: t.sortOrder,
  }));
  // 甘特需全量字段：任务树(parentTaskId)、负责人缩写、依赖/阻断、详情弹窗(description 等)
  const ganttTasks = visibleTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    completionNote: t.completionNote,
    status: t.status,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    assigneeNames: t.assigneeNames,
    milestoneId: t.milestoneId,
    parentTaskId: t.parentTaskId,
    labels: t.labels,
  }));
  // 完成-开始依赖阻塞：后置任务 id → 未完成前置任务标题列表（卡片灰化/锁图标/禁拖完成用）
  const taskById = new Map(projectTasks.map((t) => [t.id, t]));
  const blockedBy: Record<string, string[]> = {};
  for (const d of dependencies) {
    const pred = taskById.get(d.predecessorId);
    if (pred && pred.status !== "done") (blockedBy[d.successorId] ??= []).push(pred.title);
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const empty = visibleTasks.length === 0;

  // 任务详情内嵌视图：?task=<taskId> 命中本项目任务时，整页替换为详情（替代原「新窗口整页」）。
  // 数据复用本页已拉取的项目任务/成员/里程碑/标签/依赖，无额外取数。
  const selectedTaskId = typeof sp.task === "string" ? sp.task : undefined;
  const selectedRaw = selectedTaskId
    ? projectTasks.find((t) => t.id === selectedTaskId)
    : undefined;
  if (selectedRaw) {
    const selectedTask: TaskDetailTask = {
      id: selectedRaw.id,
      title: selectedRaw.title,
      description: selectedRaw.description,
      completionNote: selectedRaw.completionNote,
      status: selectedRaw.status,
      priority: selectedRaw.priority,
      startDate: selectedRaw.startDate,
      dueDate: selectedRaw.dueDate,
      assigneeIds: selectedRaw.assigneeIds,
      assigneeNames: selectedRaw.assigneeNames,
      milestoneId: selectedRaw.milestoneId,
      labels: selectedRaw.labels,
      sprintId: selectedRaw.sprintId,
      kind: selectedRaw.kind,
      bugSeverity: selectedRaw.bugSeverity,
      bugStatus: selectedRaw.bugStatus,
      relatedTaskId: selectedRaw.relatedTaskId,
      estimateHours: selectedRaw.estimateHours,
      blocked: selectedRaw.blocked,
      blockedReason: selectedRaw.blockedReason,
    };
    // 返回项目：仅移除 task/focus，保留 view 与筛选
    const back = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && k !== "task" && k !== "focus") back.set(k, v);
    }
    const backQs = back.toString();
    const backHref = `/projects/${projectId}${backQs ? `?${backQs}` : ""}`;

    return (
      <main className="mx-auto max-w-3xl space-y-6 py-8">
        <header className="space-y-2">
          <div>
            <Link href={backHref} className="ac-btn-ghost">
              ← 返回项目：{project.name}
            </Link>
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink">{selectedTask.title}</h1>
        </header>

        <TaskDetail
          projectId={projectId}
          task={selectedTask}
          canWrite={canWrite}
          viewerId={session.user.id}
          viewerRole={role}
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 py-8">
      <header>
        <h1 className="font-display text-2xl font-semibold text-ink">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-ink-soft">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          {project.startDate ?? "?"} ~ {project.endDate ?? "?"} · {project.status} ·{" "}
          <Link
            href={`/projects/${projectId}/archive`}
            className="text-primary hover:underline"
          >
            项目档案
          </Link>
          {" · "}
          <Link href={`/projects/${projectId}/sprints`} className="text-primary hover:underline">
            迭代与燃尽
          </Link>
          {" · "}
          <Link
            href={`/projects/${projectId}/retrospectives`}
            className="text-primary hover:underline"
          >
            复盘
          </Link>
          {" · "}
          <a href={`/api/projects/${projectId}/export`} className="text-primary hover:underline">
            导出 CSV
          </a>
        </p>
      </header>

      <ViewTabs projectId={projectId} view={view} />

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section className="space-y-3">
        <FilterBar
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />

        {empty ? (
          <EmptyState title="没有符合筛选的任务" hint="调整筛选条件，或清空筛选后再试。" />
        ) : view === "kanban" ? (
          <Board
            projectId={projectId}
            groupBy={filters.group}
            tasks={boardTasks}
            canWrite={canWrite}
            members={members}
            milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
            allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
            dependencies={dependencies}
            blockedBy={blockedBy}
          />
        ) : view === "list" ? (
          <ListView projectId={projectId} tasks={boardTasks} />
        ) : (
          <GanttView
            projectId={projectId}
            tasks={ganttTasks}
            milestones={projectMilestones.map((m) => ({
              id: m.id,
              title: m.title,
              targetDate: m.targetDate,
              status: m.status,
            }))}
            dependencies={dependencies}
            blockedBy={blockedBy}
            todayMs={todayMs}
          />
        )}
      </section>

      {/* 成员负载下沉到任务区之后：首屏优先露出任务本身 */}
      <MemberLoadView projectId={projectId} members={memberLoads} today={today} />

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
          sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </main>
  );
}
