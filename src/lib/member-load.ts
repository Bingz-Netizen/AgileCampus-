import type { TaskPriority, TaskStatus } from "@/db/schema";

// 成员任务负载聚合的纯函数模块。无 IO、不取系统时钟，「今日」由调用方传入，便于单测。
// 与 board-filters.ts / board-columns.ts 同级：负载口径集中于此，页面层只做渲染。

export type MemberSeed = { id: string; name: string };

export type LoadTask = {
  id: string;
  title: string;
  assigneeId: string | null;
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

export type MemberLoad = {
  id: string;
  name: string;
  openCount: number; // 未完成（todo + doing），含子任务
  doneCount: number;
  totalCount: number;
  overdueCount: number; // 逾期：dueDate < today 且未完成
  loadPercent: number; // 相对团队最高未完成数归一化，0-100 整数
  urgent: UrgentTask[]; // 最紧急 3 条（未完成，按截止时间升序）
  all: UrgentTask[]; // 全部任务（含已完成），按截止时间升序
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

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

export function computeMemberLoad(
  members: MemberSeed[],
  tasks: LoadTask[],
  today: string,
): MemberLoad[] {
  const byMember = new Map<string, LoadTask[]>();
  for (const m of members) byMember.set(m.id, []);
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    const list = byMember.get(t.assigneeId);
    if (list) list.push(t);
  }

  const isOpen = (t: LoadTask) => t.status !== "done";
  const openCounts = members.map((m) => (byMember.get(m.id) ?? []).filter(isOpen).length);
  // 分母至少为 1：全员无未完成任务时统一 0%，避免除零
  const maxOpen = Math.max(1, ...openCounts);

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
    const sortedOpen = open.map(toUrgent).sort(byDueUrgency);
    return {
      id: m.id,
      name: m.name,
      openCount,
      doneCount: list.length - openCount,
      totalCount: list.length,
      overdueCount: open.filter((t) => t.dueDate && t.dueDate < today).length,
      loadPercent: openCount === 0 ? 0 : Math.round((openCount / maxOpen) * 100),
      urgent: sortedOpen.slice(0, 3),
      all: list.map(toUrgent).sort(byDueUrgency),
    };
  });

  // 负载高者在前，便于一眼看出谁任务过多、谁无事可做
  return rows.sort(
    (a, b) =>
      b.loadPercent - a.loadPercent ||
      b.openCount - a.openCount ||
      a.name.localeCompare(b.name),
  );
}
