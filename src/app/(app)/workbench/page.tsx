import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getWorkbenchOverview,
  type RiskLevel,
  type WorkbenchProject,
  type WorkbenchTeam,
} from "@/lib/workbench";

type Props = {
  searchParams: Promise<{ view?: string }>;
};

// 风险徽章配色均取自既有设计令牌：高=high(红)、中=primary(蓝)、低=low(灰)
const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  high: { label: "高风险", className: "ac-badge bg-high-soft text-high" },
  medium: { label: "中风险", className: "ac-badge bg-primary-soft text-primary" },
  low: { label: "低风险", className: "ac-badge bg-low-soft text-low" },
};

function StatCard({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="ac-card p-4">
      <p
        className={`font-display text-2xl font-semibold tabular-nums ${
          danger && value > 0 ? "text-high" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
    </div>
  );
}

// mine=true 渲染学生口径（我的任务），false 渲染教师口径（全量三态）
function ProjectRow({ p, mine }: { p: WorkbenchProject; mine: boolean }) {
  const total = mine ? p.myTotal : p.taskTotal;
  const done = mine ? p.myDone : p.doneCount;
  const overdue = mine ? p.myOverdue : p.overdueTaskCount;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const badge = RISK_BADGE[p.risk];

  return (
    <li className="ac-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/projects/${p.id}`}
          className="min-w-0 truncate font-display text-base font-semibold text-ink hover:text-primary"
        >
          {p.name}
        </Link>
        <span className={badge.className}>{badge.label}</span>
      </div>

      <p className="mt-1 text-xs text-ink-faint">
        {mine ? (
          <>我的逾期 {overdue}</>
        ) : (
          <>
            逾期任务 {p.overdueTaskCount} · 未关闭里程碑 {p.milestoneOpenCount} · 逾期里程碑{" "}
            {p.overdueMilestoneCount}
          </>
        )}
        {p.endDate && (
          <>
            {" · "}截止 {p.endDate}
            {p.daysLeft != null &&
              (p.daysLeft >= 0 ? `（剩余 ${p.daysLeft} 天）` : `（已过 ${-p.daysLeft} 天）`)}
          </>
        )}
      </p>

      <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
        {mine ? (
          <span>我的任务</span>
        ) : (
          <span>
            待办 {p.todoCount} · 进行中 {p.doingCount} · 已完成 {p.doneCount}
          </span>
        )}
        <span className="tabular-nums">
          {mine && "我的 "}
          {done}/{total}
          {total > 0 ? ` · ${pct}%` : ""}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-done transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

function teamStats(t: WorkbenchTeam, mine: boolean) {
  return t.projects.reduce(
    (acc, p) => ({
      total: acc.total + (mine ? p.myTotal : p.taskTotal),
      done: acc.done + (mine ? p.myDone : p.doneCount),
      overdue: acc.overdue + (mine ? p.myOverdue : p.overdueTaskCount),
      highRisk: acc.highRisk + (p.risk === "high" ? 1 : 0),
    }),
    { total: 0, done: 0, overdue: 0, highRisk: 0 },
  );
}

export default async function WorkbenchPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams;
  // 视图模式（文档第 3 项口径）：auto=按各团队实际角色；student=强制学生视角（教师预览用）
  const forcedStudent = sp.view === "student";
  const today = new Date().toISOString().slice(0, 10);
  const overview = await getWorkbenchOverview(session.user.id, today);
  const hasTeacherTeam = overview.teams.some((t) => t.isTeacher);

  return (
    <main className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">工作台</h1>
        {hasTeacherTeam && (
          <div className="flex items-center gap-1 rounded-field bg-sunken p-1 text-sm">
            <Link
              href="/workbench"
              className={`rounded-field px-3 py-1 transition-colors ${
                !forcedStudent ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              教师视图
            </Link>
            <Link
              href="/workbench?view=student"
              className={`rounded-field px-3 py-1 transition-colors ${
                forcedStudent ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              学生视图
            </Link>
          </div>
        )}
      </div>

      {/* 顶部 4 张统计卡：教师=活跃项目/高风险/逾期任务/逾期里程碑；学生（含教师切学生视角）=活跃项目/高风险/我的逾期/我的未完成。
          以 hasTeacherTeam 为准而非 forcedStudent——学生没有切换开关，恒定学生口径，防止全量统计泄漏 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="活跃项目" value={overview.totals.projectCount} />
        <StatCard label="高风险项目" value={overview.totals.highRiskCount} danger />
        {!hasTeacherTeam || forcedStudent ? (
          <>
            <StatCard label="我的逾期任务" value={overview.totals.myOverdue} danger />
            <StatCard
              label="我的未完成任务"
              value={overview.totals.myTotal - overview.totals.myDone}
            />
          </>
        ) : (
          <>
            <StatCard
              label="逾期任务"
              value={overview.totals.overdueTaskCount}
              danger
            />
            <StatCard
              label="逾期里程碑"
              value={overview.totals.overdueMilestoneCount}
              danger
            />
          </>
        )}
      </div>

      {overview.teams.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          还未加入任何团队——先在「我的团队」创建或加入。
        </div>
      ) : (
        overview.teams.map((t) => {
          // 学生团队强制学生口径；教师团队随视图开关切换（服务端兜底，学生手输 URL 也只见本人口径）
          const mine = !t.isTeacher || forcedStudent;
          const stats = teamStats(t, mine);
          return (
            <section key={t.teamId} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-ink">
                    {t.teamName}
                  </h2>
                  <span
                    className={
                      t.isTeacher
                        ? "ac-badge bg-primary-soft text-primary"
                        : "ac-badge bg-low-soft text-low"
                    }
                  >
                    {t.isTeacher ? "教师视角" : "学生视角"}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-ink-soft">
                  {t.projects.length} 个项目 · 任务 {stats.done}/{stats.total} · 逾期{" "}
                  {stats.overdue} · 高风险 {stats.highRisk}
                </span>
              </div>
              {t.projects.length === 0 ? (
                <div className="ac-card p-4 text-center text-xs text-ink-soft">
                  该团队暂无活跃项目
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {t.projects.map((p) => (
                    <ProjectRow key={p.id} p={p} mine={mine} />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </main>
  );
}
