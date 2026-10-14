import type { TaskPriority, TaskStatus } from "@/db/schema";

// 成员任务负载聚合的纯函数模块。无 IO、不取系统时钟，「今日」由调用方传入，便于单测。
// 与 board-filters.ts / board-columns.ts 同级：负载口径集中于此，页面层只做渲染。

export type MemberSeed = { id: string; name: string };

export type LoadTask = {
  id: string;
  title: string;
  assigneeIds: string[];
  status: TaskStatus;
  dueDate: string | null;
  priority: TaskPriority;
};

export type UrgentTask = {
  id: string;
  title: string;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority;
};

export type LoadLevel = "normal" | "busy" | "overload";

export type MemberLoad = {
  id: string;
  name: string;
  openCount: number; // 未完成（todo + doing），含子任务
  doneCount: number;
  totalCount: number;
  overdueCount: number; // 逾期：未完成且 dueDate < today
  todayDueCount: number; // 今日截止
  dueIn3DaysCount: number; // 1–3 天内截止
  dueIn7DaysCount: number; // 4–7 天内截止
  dueLaterCount: number; // 7 天以上截止
  baseScore: number; // 任务数量基础分 = min(未完成数 × 4, 40)
  deadlinePressure: number; // 截止压力分 = min(加权和, 60)
  loadScore: number; // 负载评分 = min(100, round(基础分 + 压力分))
  loadLevel: LoadLevel; // 0–59 normal / 60–79 busy / 80–100 overload
  urgent: UrgentTask[]; // 最紧急 3 条（未完成，按截止时间升序）
  all: UrgentTask[]; // 全部任务（含已完成），按截止时间升序
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const MS_DAY = 86_400_000;

// 截止时间升序（空截止排最后）；同截止按优先级高→低，再按标题。
function byDueUrgency(a: UrgentTask, b: UrgentTask): number {
  const ad = a.dueDate;
  const bd = b.dueDate;
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  const ap = PRIORITY_ORDER[a.priority] ?? 2;
  const bp = PRIORITY_ORDER[b.priority] ?? 2;
  if (ap !== bp) return ap - bp;
  return a.title.localeCompare(b.title);
}

// 距今日的整数天数。date-only 串（YYYY-MM-DD）按 UTC 解析，差值不受本地时区影响。
function daysFromToday(dueDate: string, today: string): number {
  return Math.round((Date.parse(dueDate) - Date.parse(today)) / MS_DAY);
}

export function computeMemberLoad(
  members: MemberSeed[],
  tasks: LoadTask[],
  today: string,
): MemberLoad[] {
  const byMember = new Map<string, LoadTask[]>();
  for (const m of members) byMember.set(m.id, []);
  for (const t of tasks) {
    // 一任务多负责人：计入每一位负责人的负载桶
    for (const id of t.assigneeIds) {
      const list = byMember.get(id);
      if (list) list.push(t);
    }
  }

  const isOpen = (t: LoadTask) => t.status !== "done";

  const toUrgent = (t: LoadTask): UrgentTask => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    status: t.status,
    priority: t.priority,
  });

  const rows = members.map((m): MemberLoad => {
    const list = byMember.get(m.id) ?? [];
    const open = list.filter(isOpen);
    const openCount = open.length;

    // 截止压力分桶：仅未完成任务；无截止日期的任务只计入数量分，不入压力分
    let overdueCount = 0;
    let todayDueCount = 0;
    let dueIn3DaysCount = 0;
    let dueIn7DaysCount = 0;
    let dueLaterCount = 0;
    for (const t of open) {
      if (!t.dueDate) continue;
      const d = daysFromToday(t.dueDate, today);
      if (d < 0) overdueCount++;
      else if (d === 0) todayDueCount++;
      else if (d <= 3) dueIn3DaysCount++;
      else if (d <= 7) dueIn7DaysCount++;
      else dueLaterCount++;
    }

    const baseScore = Math.min(openCount * 4, 40);
    const deadlinePressure = Math.min(
      overdueCount * 15 +
        todayDueCount * 12 +
        dueIn3DaysCount * 8 +
        dueIn7DaysCount * 4 +
        dueLaterCount * 1,
      60,
    );
    const loadScore = Math.min(100, Math.round(baseScore + deadlinePressure));
    const loadLevel: LoadLevel =
      loadScore >= 80 ? "overload" : loadScore >= 60 ? "busy" : "normal";

    return {
      id: m.id,
      name: m.name,
      openCount,
      doneCount: list.length - openCount,
      totalCount: list.length,
      overdueCount,
      todayDueCount,
      dueIn3DaysCount,
      dueIn7DaysCount,
      dueLaterCount,
      baseScore,
      deadlinePressure,
      loadScore,
      loadLevel,
      urgent: open.map(toUrgent).sort(byDueUrgency).slice(0, 3),
      all: list.map(toUrgent).sort(byDueUrgency),
    };
  });

  // 评分高者在前，便于一眼看出谁任务过多、谁无事可做
  return rows.sort(
    (a, b) =>
      b.loadScore - a.loadScore ||
      b.openCount - a.openCount ||
      a.name.localeCompare(b.name),
  );
}
