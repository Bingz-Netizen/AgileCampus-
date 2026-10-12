import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { conversations, messages as messagesTable } from "@/db/schema";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { countProjectTaskComments } from "@/lib/comment";
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { computeMemberLoad } from "@/lib/member-load";
import { parseView } from "./view-nav";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { Board } from "./board";
import { ListView } from "./list-view";
import { GanttView } from "./gantt-view";
import { ViewTabs } from "./view-tabs";
import { EmptyState } from "./empty-state";
import { ChatPanel } from "./chat-panel";
import { FilterBar } from "./filter-bar";
import { MemberLoadView } from "./member-load-view";

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

  const [projectMilestones, projectTasks, members, dependencies, teamLabels, commentCounts] =
    await Promise.all([
      listProjectMilestones(session.user.id, projectId),
      listProjectTasks(session.user.id, projectId),
      listTeamMembers(project.teamId),
      listProjectDependencies(session.user.id, projectId),
      listTeamLabels(session.user.id, project.teamId),
      countProjectTaskComments(session.user.id, projectId),
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

  const canWrite = role === "admin" || role === "student";
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
    assigneeName: t.assigneeName,
    assigneeId: t.assigneeId,
    milestoneId: t.milestoneId,
    labels: t.labels,
    commentCount: commentCounts[t.id] ?? 0,
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
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
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

  const [latestConv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  const history = latestConv
    ? await db
        .select({ role: messagesTable.role, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, latestConv.id))
        .orderBy(messagesTable.createdAt)
    : [];

  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

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
        </p>
      </header>

      <MemberLoadView projectId={projectId} members={memberLoads} today={today} />

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
            allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
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
            members={members.map((m) => ({ id: m.id, name: m.name }))}
            allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
            blockedBy={blockedBy}
            canWrite={canWrite}
            todayMs={todayMs}
          />
        )}
      </section>

      <ChatPanel
        projectId={projectId}
        initialMessages={initialMessages}
        members={members}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
      />

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
        />
      )}
    </main>
  );
}
