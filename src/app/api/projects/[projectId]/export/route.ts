import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { milestones, sprints, tasks } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";

// 平台数据导出（D4/D6 交付物：迭代记录、任务记录直接导出）。
// GET /api/projects/[projectId]/export → CSV（带 BOM，Excel 双击不乱码）

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };
const KIND_LABEL: Record<string, string> = { feature: "功能", bug: "缺陷" };
const SEVERITY_LABEL: Record<string, string> = {
  blocker: "阻断级",
  major: "重要级",
  minor: "优化级",
};
const BUG_STATUS_LABEL: Record<string, string> = {
  open: "待处理",
  fixing: "处理中",
  fixed: "已修复",
  verified: "验证通过",
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) return new Response("未登录", { status: 401 });

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) return new Response("项目不存在或无权访问", { status: 404 });

  // ?type=sprints → 迭代记录导出；缺省导出任务记录
  const type = new URL(request.url).searchParams.get("type");
  if (type === "sprints") return exportSprints(projectId);

  return exportTasks(projectId);
}

async function exportSprints(projectId: string) {
  // 分两次取数再在内存里聚合：相关子查询在 drizzle 的 sql 模板里易踩表别名的坑，
  // 项目级数据量很小，简单聚合更稳。
  const [rows, taskRows] = await Promise.all([
    db
      .select({
        id: sprints.id,
        name: sprints.name,
        goal: sprints.goal,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        status: sprints.status,
        createdAt: sprints.createdAt,
      })
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(sprints.createdAt),
    db
      .select({
        sprintId: tasks.sprintId,
        status: tasks.status,
        estimateHours: tasks.estimateHours,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
  ]);

  const header = ["迭代", "目标", "开始", "结束", "状态", "任务数", "已完成", "总工时(h)", "剩余工时(h)", "创建时间"];
  const body = rows.map((r) => {
    const mine = taskRows.filter((t) => t.sprintId === r.id);
    const totalHours = mine.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
    const remainingHours = mine.reduce(
      (sum, t) => sum + (t.status === "done" ? 0 : (t.estimateHours ?? 0)),
      0,
    );
    return [
      r.name,
      r.goal,
      r.startDate,
      r.endDate,
      r.status === "active" ? "进行中" : "已关闭",
      mine.length,
      mine.filter((t) => t.status === "done").length,
      totalHours,
      remainingHours,
      r.createdAt.toISOString(),
    ];
  });

  return csvResponse([header, ...body], "agilecampus-sprints");
}

async function exportTasks(projectId: string) {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      estimateHours: tasks.estimateHours,
      bugSeverity: tasks.bugSeverity,
      bugStatus: tasks.bugStatus,
      blocked: tasks.blocked,
      blockedReason: tasks.blockedReason,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      sprintName: sprints.name,
      milestoneName: milestones.title,
      assignees: sql<string | null>`(
        select string_agg(u.name, '、' order by u.name)
        from task_assignees ta join users u on u.id = ta.user_id
        where ta.task_id = ${tasks.id}
      )`,
    })
    .from(tasks)
    .leftJoin(sprints, eq(tasks.sprintId, sprints.id))
    .leftJoin(milestones, eq(tasks.milestoneId, milestones.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);

  const header = [
    "任务ID",
    "标题",
    "类型",
    "状态",
    "优先级",
    "负责人",
    "迭代",
    "里程碑",
    "开始日期",
    "截止日期",
    "预估工时(h)",
    "缺陷严重级",
    "缺陷状态",
    "阻塞",
    "阻塞原因",
    "完成时间",
    "创建时间",
  ];

  const body = rows.map((r) => [
    r.id,
    r.title,
    KIND_LABEL[r.kind] ?? r.kind,
    STATUS_LABEL[r.status] ?? r.status,
    r.priority,
    r.assignees,
    r.sprintName,
    r.milestoneName,
    r.startDate,
    r.dueDate,
    r.estimateHours,
    r.bugSeverity ? (SEVERITY_LABEL[r.bugSeverity] ?? r.bugSeverity) : "",
    r.bugStatus ? (BUG_STATUS_LABEL[r.bugStatus] ?? r.bugStatus) : "",
    r.blocked ? "是" : "否",
    r.blockedReason,
    r.completedAt ? r.completedAt.toISOString() : "",
    r.createdAt.toISOString(),
  ]);

  const csv = `\uFEFF${toCsv([header, ...body])}`;
  return csvResponse(csv, "agilecampus-tasks");
}

function csvResponse(input: string | unknown[][], basename: string) {
  const csv =
    typeof input === "string" ? input : `\uFEFF${toCsv(input)}`;
  const filename = `${basename}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
