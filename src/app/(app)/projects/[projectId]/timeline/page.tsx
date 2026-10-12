import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { listTeamLabels } from "@/lib/label";
import { GanttView } from "../gantt-view";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const [tasks, milestones, members, dependencies, teamLabels] = await Promise.all([
    listProjectTasks(session.user.id, projectId),
    listProjectMilestones(session.user.id, projectId),
    listTeamMembers(access.project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, access.project.teamId),
  ]);

  // 完成-开始依赖阻塞：后置任务 id → 未完成前置任务标题列表（甘特斜纹用）
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const blockedBy: Record<string, string[]> = {};
  for (const d of dependencies) {
    const pred = taskById.get(d.predecessorId);
    if (pred && pred.status !== "done") (blockedBy[d.successorId] ??= []).push(pred.title);
  }

  const canWrite = access.role === "admin" || access.role === "student";

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <header className="space-y-1">
        <Link href={`/projects/${projectId}`} className="text-xs text-ink-soft hover:text-primary">
          ← 返回项目
        </Link>
        <h1 className="font-display text-2xl font-semibold text-ink">
          {access.project.name} · 时间线
        </h1>
        <p className="text-sm text-ink-soft">
          左侧任务树 + 右侧时间轴。横条为任务 [起始日→截止日]，菱形为里程碑，竖线为今日；可切换日/周/月缩放。
        </p>
      </header>

      <GanttView
        projectId={projectId}
        tasks={tasks.map((t) => ({
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
        }))}
        milestones={milestones.map((m) => ({
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
    </main>
  );
}
