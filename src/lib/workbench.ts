import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  milestones,
  projects,
  tasks,
  teamMembers,
  teams,
} from "@/db/schema";

// 工作台聚合：教师总览（多项目进度/风险/逾期）+ 学生/教师双视图口径（文档第 1、3 项）。
// 口径与 member-load.ts 一致：逾期 = 未完成且截止 < today；时钟不进本模块，today 由调用方传入，便于单测。

// 教师判定：团队内 admin / teacher 视为教师
const TEACHER_ROLES = ["admin", "teacher"] as const;

export type RiskLevel = "high" | "medium" | "low";

export type WorkbenchProject = {
  id: string;
  name: string;
  teamId: string;
  endDate: string | null;
  daysLeft: number | null; // 项目截止剩余天数；无截止为 null，已过期为负
  todoCount: number;
  doingCount: number;
  doneCount: number;
  taskTotal: number;
  overdueTaskCount: number;
  milestoneOpenCount: number;
  overdueMilestoneCount: number;
  myTotal: number;
  myDone: number;
  myOverdue: number;
  risk: RiskLevel;
};

export type WorkbenchTeam = {
  teamId: string;
  teamName: string;
  isTeacher: boolean; // 当前用户在该团队是否 admin/teacher
  projects: WorkbenchProject[];
};

export type WorkbenchTotals = {
  projectCount: number;
  highRiskCount: number;
  // 逾期任务按各团队生效视图聚合：教师团队计全量、学生团队计本人（防越权汇总）
  overdueTaskCount: number;
  // 里程碑是项目级概念（不指派到人），恒按全量口径
  overdueMilestoneCount: number;
  myTotal: number;
  myDone: number;
  myOverdue: number;
};

export type WorkbenchOverview = {
  teams: WorkbenchTeam[];
  totals: WorkbenchTotals;
};

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

// 统一走 UTC 日算术，与 "YYYY-MM-DD" 字符串比较同构（today 取法同 notify.ts:103）
function diffDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

// 三级风险（第一阶段文档口径）：
// 高 = 存在逾期任务或逾期里程碑；中 = 里程碑或项目 7 天内到期；低 = 其余。
function computeRisk(
  overdueTaskCount: number,
  overdueMilestoneCount: number,
  milestoneDueSoon: number,
  endDate: string | null,
  today: string,
): RiskLevel {
  if (overdueTaskCount > 0 || overdueMilestoneCount > 0) return "high";
  if (milestoneDueSoon > 0) return "medium";
  if (endDate) {
    const left = diffDays(today, endDate);
    if (left >= 0 && left <= 7) return "medium";
  }
  return "low";
}

export async function getWorkbenchOverview(
  actorId: string,
  today: string,
): Promise<WorkbenchOverview> {
  const emptyTotals: WorkbenchTotals = {
    projectCount: 0,
    highRiskCount: 0,
    overdueTaskCount: 0,
    overdueMilestoneCount: 0,
    myTotal: 0,
    myDone: 0,
    myOverdue: 0,
  };

  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, actorId));
  if (memberships.length === 0) return { teams: [], totals: emptyTotals };

  // 仅聚合活跃项目（archived 不进工作台，沿文档「活跃项目」口径）
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      endDate: projects.endDate,
      teamId: projects.teamId,
      teamName: teams.name,
    })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .where(
      and(
        inArray(projects.teamId, memberships.map((m) => m.teamId)),
        eq(projects.status, "active"),
      ),
    )
    .orderBy(projects.name);
  if (projectRows.length === 0) return { teams: [], totals: emptyTotals };

  const projectIds = projectRows.map((p) => p.id);

  // 任务聚合：一条 SQL 同时产出三态计数、逾期数与「我的」口径（count filter 括号包裹保证 ::int 作用于整体）
  const taskAggRows = await db
    .select({
      projectId: tasks.projectId,
      todo: sql<number>`(count(*) filter (where ${tasks.status} = 'todo'))::int`,
      doing: sql<number>`(count(*) filter (where ${tasks.status} = 'doing'))::int`,
      done: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
      overdue: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}))::int`,
      myTotal: sql<number>`(count(*) filter (where ${tasks.assigneeId} = ${actorId}))::int`,
      myDone: sql<number>`(count(*) filter (where ${tasks.assigneeId} = ${actorId} and ${tasks.status} = 'done'))::int`,
      myOverdue: sql<number>`(count(*) filter (where ${tasks.assigneeId} = ${actorId} and ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}))::int`,
    })
    .from(tasks)
    .where(inArray(tasks.projectId, projectIds))
    .groupBy(tasks.projectId);
  const taskAgg = new Map(taskAggRows.map((r) => [r.projectId, r]));

  // 里程碑聚合：未关闭数、逾期数（open 且 targetDate < today）、7 天内到期数
  const in7 = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const msAggRows = await db
    .select({
      projectId: milestones.projectId,
      open: sql<number>`(count(*) filter (where ${milestones.status} = 'open'))::int`,
      overdue: sql<number>`(count(*) filter (where ${milestones.status} = 'open' and ${milestones.targetDate} < ${today}))::int`,
      dueSoon: sql<number>`(count(*) filter (where ${milestones.status} = 'open' and ${milestones.targetDate} >= ${today} and ${milestones.targetDate} <= ${in7}))::int`,
    })
    .from(milestones)
    .where(inArray(milestones.projectId, projectIds))
    .groupBy(milestones.projectId);
  const msAgg = new Map(msAggRows.map((r) => [r.projectId, r]));

  const roleByTeam = new Map(memberships.map((m) => [m.teamId, m.role]));
  const byTeam = new Map<string, WorkbenchTeam>();
  const all: WorkbenchProject[] = [];

  for (const p of projectRows) {
    const t = taskAgg.get(p.id);
    const m = msAgg.get(p.id);
    const todo = t?.todo ?? 0;
    const doing = t?.doing ?? 0;
    const done = t?.done ?? 0;
    const overdueTaskCount = t?.overdue ?? 0;
    const milestoneOpenCount = m?.open ?? 0;
    const overdueMilestoneCount = m?.overdue ?? 0;
    const daysLeft = p.endDate ? diffDays(today, p.endDate) : null;

    const wp: WorkbenchProject = {
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      endDate: p.endDate,
      daysLeft,
      todoCount: todo,
      doingCount: doing,
      doneCount: done,
      taskTotal: todo + doing + done,
      overdueTaskCount,
      milestoneOpenCount,
      overdueMilestoneCount,
      myTotal: t?.myTotal ?? 0,
      myDone: t?.myDone ?? 0,
      myOverdue: t?.myOverdue ?? 0,
      risk: computeRisk(
        overdueTaskCount,
        overdueMilestoneCount,
        m?.dueSoon ?? 0,
        p.endDate,
        today,
      ),
    };
    all.push(wp);

    let team = byTeam.get(p.teamId);
    if (!team) {
      const role = roleByTeam.get(p.teamId) ?? "student";
      team = {
        teamId: p.teamId,
        teamName: p.teamName,
        isTeacher: (TEACHER_ROLES as readonly string[]).includes(role),
        projects: [],
      };
      byTeam.set(p.teamId, team);
    }
    team.projects.push(wp);
  }

  // 风险高→低置顶；同风险按剩余天数紧迫（无截止靠后），再按名称
  const byUrgency = (a: WorkbenchProject, b: WorkbenchProject) =>
    RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
    (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) ||
    a.name.localeCompare(b.name);
  for (const team of byTeam.values()) team.projects.sort(byUrgency);

  // 汇总：任务口径随各团队生效视图（教师全量/学生本人），里程碑恒全量
  const totals: WorkbenchTotals = { ...emptyTotals, projectCount: all.length };
  for (const team of byTeam.values()) {
    for (const p of team.projects) {
      if (p.risk === "high") totals.highRiskCount += 1;
      totals.overdueMilestoneCount += p.overdueMilestoneCount;
      totals.myTotal += p.myTotal;
      totals.myDone += p.myDone;
      totals.myOverdue += p.myOverdue;
      totals.overdueTaskCount += team.isTeacher ? p.overdueTaskCount : p.myOverdue;
    }
  }

  return { teams: [...byTeam.values()], totals };
}

// 布局导航用：用户是否在任意团队拥有教师/管理员角色（决定「工作台」入口是否渲染）。
// 学生即使手输 URL 进入 /workbench，页面仍按学生口径渲染，不泄露全量数据。
export async function hasTeacherRoleAnywhere(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        inArray(teamMembers.role, [...TEACHER_ROLES]),
      ),
    )
    .limit(1);
  return row != null;
}
