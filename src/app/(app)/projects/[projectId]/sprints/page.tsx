import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { buildBurndown, listProjectSprints, listUnassignedTasks, sprintSummary } from "@/lib/sprint";
import { BurndownChart } from "./burndown-chart";
import { AssignTasksForm } from "./assign-tasks-form";
import { CloseSprintButton, SprintCreateForm } from "./sprint-forms";

export default async function SprintsPage({
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
  const { project, role } = access;
  const canWrite = role === "admin" || role === "student" || role === "leader";

  const sprints = await listProjectSprints(session.user.id, projectId);
  const today = new Date().toLocaleDateString("sv-SE");
  const active = sprints.find((s) => s.status === "active") ?? sprints[0];

  let points = [] as ReturnType<typeof buildBurndown>;
  let summary = sprintSummary([]);
  let unassigned: Awaited<ReturnType<typeof listUnassignedTasks>> = [];
  if (active) {
    const rows = await db
      .select({
        estimateHours: tasks.estimateHours,
        completedAt: tasks.completedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.sprintId, active.id));
    points = buildBurndown(active, rows, today);
    summary = sprintSummary(rows);
    if (canWrite && active.status === "active") {
      unassigned = await listUnassignedTasks(session.user.id, projectId);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <header className="space-y-1">
        <Link href={`/projects/${projectId}`} className="ac-btn-ghost">
          ← 返回项目：{project.name}
        </Link>
        <h1 className="font-display text-2xl font-semibold text-ink">迭代与燃尽</h1>
        <p className="text-sm text-ink-soft">
          任务归入迭代后，燃尽图按「预估工时」计算剩余工作量。未填估时的任务不计入曲线。
          {" · "}
          <a href={`/api/projects/${projectId}/export?type=sprints`} className="text-primary hover:underline">
            导出迭代记录 CSV
          </a>
        </p>
      </header>

      {active ? (
        <section className="ac-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">{active.name}</h2>
              <p className="text-xs text-ink-faint">
                {active.startDate ?? "?"} ~ {active.endDate ?? "?"} · {active.status === "active" ? "进行中" : "已关闭"}
                {active.goal ? ` · ${active.goal}` : ""}
              </p>
            </div>
            {canWrite && active.status === "active" && (
              <CloseSprintButton projectId={projectId} sprintId={active.id} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["任务数", summary.count],
              ["已完成", summary.done],
              ["总工时", summary.total],
              ["剩余工时", summary.remaining],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-sunken p-3">
                <p className="font-display text-xl font-semibold tabular-nums text-ink">{value}</p>
                <p className="text-xs text-ink-soft">{label}</p>
              </div>
            ))}
          </div>

          <BurndownChart points={points} today={today} />
          {summary.unestimated > 0 && (
            <p className="text-xs text-ink-faint">
              有 {summary.unestimated} 个任务未填预估工时，不计入燃尽曲线——在任务详情里补「估时」即可。
            </p>
          )}

          {canWrite && active.status === "active" && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <h3 className="text-sm font-medium text-ink">把未排期任务拉进本迭代</h3>
              <AssignTasksForm
                projectId={projectId}
                sprintId={active.id}
                tasks={unassigned.map((t) => ({
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  kind: t.kind,
                  estimateHours: t.estimateHours,
                }))}
              />
            </div>
          )}
        </section>
      ) : (
        <div className="ac-card p-6 text-center text-sm text-ink-soft">
          还没有迭代。先建一个「最后一周收敛」迭代，再把任务挂上去。
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-ink">全部迭代</h2>
        <ul className="space-y-2">
          {sprints.map((s) => (
            <li key={s.id} className="ac-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="ml-2 text-xs text-ink-faint">
                  {s.startDate ?? "?"} ~ {s.endDate ?? "?"} · {s.status === "active" ? "进行中" : "已关闭"}
                </span>
              </span>
              <span className="text-xs tabular-nums text-ink-soft">
                任务 {s.doneCount}/{s.taskCount} · 剩余 {s.remainingHours}h / 共 {s.totalHours}h
              </span>
            </li>
          ))}
          {sprints.length === 0 && <li className="text-sm text-ink-faint">暂无迭代</li>}
        </ul>
      </section>

      {canWrite && <SprintCreateForm projectId={projectId} />}
    </main>
  );
}
