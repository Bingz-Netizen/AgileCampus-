"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "./empty-state";
import { withTask } from "./view-nav";

const DAY = 86_400_000;
const ROW_H = 36;

type Zoom = "day" | "week" | "month";
const ZOOM_OPTIONS: { key: Zoom; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
];
// 每缩放档的「每天像素」，条宽与刻度都由此推算，保证三档下条与网格对齐
const ZOOM_PX_PER_DAY: Record<Zoom, number> = { day: 40, week: 8, month: 2 };

type GanttTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeNames: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
  labels: { id: string; name: string; color: string }[];
};

type GanttMilestone = {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
};

type Row =
  | { kind: "task"; id: string; task: GanttTask; depth: number }
  | { kind: "milestone"; id: string; milestone: GanttMilestone };

const STATUS_BAR: Record<string, string> = {
  todo: "bg-todo",
  doing: "bg-doing",
  done: "bg-done",
};
const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

// 前置未完成 → 灰色斜纹（用设计系统暖灰，斜 45° 重复条带）
const BLOCKED_STYLE: React.CSSProperties = {
  backgroundColor: "var(--color-sunken)",
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--color-line) 0 6px, var(--color-sunken) 6px 12px)",
  color: "var(--color-ink-soft)",
};

// "YYYY-MM-DD" → 本地零点毫秒；无值返回 null
function parseDay(s: string | null): number | null {
  if (!s) return null;
  const t = new Date(`${s}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ms: number): number {
  const d = new Date(ms);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function addDays(ms: number, n: number): number {
  return ms + n * DAY;
}
function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

// 日历对齐的刻度：日=每天、周=每周一、月=每月 1 号
function buildTicks(rangeStart: number, rangeEnd: number, zoom: Zoom): number[] {
  const ticks: number[] = [];
  let t =
    zoom === "day"
      ? startOfDay(rangeStart)
      : zoom === "week"
        ? startOfWeek(rangeStart)
        : startOfMonth(rangeStart);
  while (t <= rangeEnd) {
    ticks.push(t);
    if (zoom === "day") t = addDays(t, 1);
    else if (zoom === "week") t = addDays(t, 7);
    else t = addMonths(t, 1);
  }
  return ticks;
}

function tickLabel(ms: number, zoom: Zoom): string {
  const d = new Date(ms);
  if (zoom === "month") return `${d.getFullYear()}/${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 负责人缩写：西文取各词首字母，中文取前两字
function initials(name: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const s = name.trim();
  return s.length > 2 ? s.slice(0, 2) : s;
}

// 左栏「距今日最近」排序依据：进行中=0，其余取与最近日期的绝对差；无日期=无穷大沉底
function proximityToToday(row: Row, todayMs: number): number {
  if (row.kind === "milestone") {
    const d = parseDay(row.milestone.targetDate);
    return d === null ? Number.POSITIVE_INFINITY : Math.abs(d - todayMs);
  }
  const ds: number[] = [];
  const s = parseDay(row.task.startDate);
  const d = parseDay(row.task.dueDate);
  if (s !== null) ds.push(s);
  if (d !== null) ds.push(d);
  if (ds.length === 0) return Number.POSITIVE_INFINITY;
  const lo = Math.min(...ds);
  const hi = Math.max(...ds);
  if (lo <= todayMs && todayMs <= hi) return 0;
  return Math.min(...ds.map((v) => Math.abs(v - todayMs)));
}

export function GanttView({
  projectId,
  tasks,
  milestones,
  dependencies,
  blockedBy,
  todayMs,
}: {
  projectId: string;
  tasks: GanttTask[];
  milestones: GanttMilestone[];
  dependencies: { predecessorId: string; successorId: string }[];
  blockedBy: Record<string, string[]>;
  todayMs: number;
}) {
  const [zoom, setZoom] = useState<Zoom>("day");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // 跨视图 ?focus=<taskId> 进入时同步选中。渲染期调整而非 useEffect：
  // 避免多渲染一轮（与 task-card 深链同一手法），也躲开 set-state-in-effect 规则。
  const [prevFocus, setPrevFocus] = useState<string | null>(null);
  if (focusParam && focusParam !== prevFocus) {
    setPrevFocus(focusParam);
    setSelectedId(focusParam);
  }

  // 选中变化（含缩放）后把对应行滚进视野
  useEffect(() => {
    if (!selectedId) return;
    const el = rowRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId, zoom]);

  // 已排期（有起始或截止日）与未排期分开；里程碑只取已定日期者
  const scheduled: { task: GanttTask; start: number; end: number }[] = [];
  const unscheduled: GanttTask[] = [];
  for (const t of tasks) {
    const s = parseDay(t.startDate);
    const d = parseDay(t.dueDate);
    if (s === null && d === null) {
      unscheduled.push(t);
      continue;
    }
    const start = s ?? d!;
    let end = (d ?? s!) + DAY; // 截止日含当日 → +1 天
    if (end <= start) end = start + DAY;
    scheduled.push({ task: t, start, end });
  }

  if (tasks.length === 0) {
    return (
      <EmptyState title="没有任务" hint="新建任务并填上起始/截止日，即可在此排成时间线。" />
    );
  }

  return (
    <div className="space-y-3">
      {scheduled.length === 0 ? (
        <EmptyState
          title="尚无已排期任务"
          hint="给任务填上起始日或截止日，即可在此排成时间线。"
        />
      ) : (
        <Timeline
          scheduled={scheduled}
          milestones={milestones}
          dependencies={dependencies}
          blockedBy={blockedBy}
          todayMs={todayMs}
          zoom={zoom}
          onZoomChange={setZoom}
          selectedId={selectedId}
          rowRefs={rowRefs}
          onSelect={setSelectedId}
          onOpenTask={(t) => {
            setSelectedId(t.id);
            const qs = withTask(new URLSearchParams(searchParams.toString()), t.id);
            router.replace(`/projects/${projectId}?${qs}`);
          }}
        />
      )}

      {unscheduled.length > 0 && (
        <section className="ac-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            未排期（{unscheduled.length}）
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.map((t) => (
              <li key={t.id} className="ac-badge bg-sunken text-ink-soft">
                {t.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Timeline({
  scheduled,
  milestones,
  dependencies,
  blockedBy,
  todayMs,
  zoom,
  onZoomChange,
  selectedId,
  rowRefs,
  onSelect,
  onOpenTask,
}: {
  scheduled: { task: GanttTask; start: number; end: number }[];
  milestones: GanttMilestone[];
  dependencies: { predecessorId: string; successorId: string }[];
  blockedBy: Record<string, string[]>;
  todayMs: number;
  zoom: Zoom;
  onZoomChange: (z: Zoom) => void;
  selectedId: string | null;
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  onSelect: (id: string) => void;
  onOpenTask: (task: GanttTask) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  // 时间范围：涵盖全部任务条 + 里程碑 + 今日，前后各留 3 天
  let minMs = todayMs;
  let maxMs = todayMs + DAY;
  for (const { start, end } of scheduled) {
    if (start < minMs) minMs = start;
    if (end > maxMs) maxMs = end;
  }
  for (const m of milestones) {
    const d = parseDay(m.targetDate);
    if (d !== null) {
      if (d < minMs) minMs = d;
      if (d + DAY > maxMs) maxMs = d + DAY;
    }
  }
  let rangeStart = minMs - 3 * DAY;
  let rangeEnd = maxMs + 3 * DAY;
  // 极短项目也至少铺满两周，避免时间轴窄得看不清
  if (rangeEnd - rangeStart < 14 * DAY) {
    const mid = (rangeStart + rangeEnd) / 2;
    rangeStart = mid - 7 * DAY;
    rangeEnd = mid + 7 * DAY;
  }

  const pxPerDay = ZOOM_PX_PER_DAY[zoom];
  const x = (ms: number) => ((ms - rangeStart) / DAY) * pxPerDay;
  const totalWidth = Math.round(x(rangeEnd));
  const ticks = buildTicks(rangeStart, rangeEnd, zoom);

  // 任务树：顶层 → 子级（缩进）；孤立任务（父任务被筛掉/未排期）兜底为顶层
  const spanByTask = new Map<string, { start: number; end: number }>();
  for (const { task, start, end } of scheduled) spanByTask.set(task.id, { start, end });

  const childrenByParent = new Map<string | null, GanttTask[]>();
  for (const { task } of scheduled) {
    const arr = childrenByParent.get(task.parentTaskId) ?? [];
    arr.push(task);
    childrenByParent.set(task.parentTaskId, arr);
  }
  const rows: Row[] = [];
  const rowIndexByTask = new Map<string, number>();
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const t of childrenByParent.get(parentId) ?? []) {
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      rowIndexByTask.set(t.id, rows.length);
      rows.push({ kind: "task", id: t.id, task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const { task } of scheduled) {
    if (visited.has(task.id)) continue;
    rowIndexByTask.set(task.id, rows.length);
    rows.push({ kind: "task", id: task.id, task: task, depth: 0 });
  }
  for (const m of milestones) {
    if (m.targetDate) rows.push({ kind: "milestone", id: m.id, milestone: m });
  }
  // 左栏按「距今日最近」排序（进行中/最近日期在前），时间轴仍保持任务树顺序
  const leftRows = [...rows].sort((a, b) => {
    const pa = proximityToToday(a, todayMs);
    const pb = proximityToToday(b, todayMs);
    return pa === pb ? 0 : pa - pb;
  });

  // 依赖箭头：前置条右缘 → 后置条左缘（仅当两任务都在轴上时画）
  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const dep of dependencies) {
    const pred = spanByTask.get(dep.predecessorId);
    const succ = spanByTask.get(dep.successorId);
    const r1 = rowIndexByTask.get(dep.predecessorId);
    const r2 = rowIndexByTask.get(dep.successorId);
    if (pred == null || succ == null || r1 == null || r2 == null) continue;
    arrows.push({
      x1: x(pred.end),
      y1: r1 * ROW_H + ROW_H / 2,
      x2: x(succ.start),
      y2: r2 * ROW_H + ROW_H / 2,
    });
  }

  const todayX = x(todayMs);

  return (
    <div className="ac-card overflow-hidden">
      {/* 顶部工具条：图例 + 缩放 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-ink-soft">
          <Legend cls="bg-done" label="完成" />
          <Legend cls="bg-doing" label="进行中" />
          <Legend cls="bg-todo" label="待办" />
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-high" />
            逾期
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={BLOCKED_STYLE}
            />
            前置未完成
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45 bg-accent" />
            里程碑
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-px bg-accent" /> 今日
          </span>
        </div>
        <ZoomSwitch zoom={zoom} onChange={onZoomChange} />
      </div>

      <div className="flex">
        {/* 左：任务树（仅显距今日最近的 5 条，其余上下滚动；放大模式隐藏） */}
        {!maximized && (
          <div className="w-64 shrink-0 border-r border-line">
            <div className="flex h-10 items-center border-b border-line px-3 text-xs font-semibold text-ink-soft">
              任务
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 5 * ROW_H }}>
              <ul>
                {leftRows.map((row) => {
                  const selected = selectedId === row.id;
                  if (row.kind === "milestone") {
                    const done = row.milestone.status === "done";
                    return (
                      <li
                        key={row.id}
                        className={`flex h-9 items-center gap-1.5 border-b border-line/60 px-3 text-xs transition ${
                          selected ? "bg-accent-soft" : ""
                        }`}
                      >
                        <span className={done ? "text-done" : "text-accent"}>◆</span>
                        <span className="truncate text-ink-soft">{row.milestone.title}</span>
                      </li>
                    );
                  }
                  const t = row.task;
                  const overdue =
                    t.status !== "done" &&
                    t.dueDate !== null &&
                    (parseDay(t.dueDate) ?? 0) < todayMs;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(t.id)}
                        className={`flex h-9 w-full items-center gap-1.5 border-b border-line/60 px-3 text-left text-xs transition ${
                          selected ? "bg-accent-soft" : "hover:bg-sunken"
                        }`}
                        style={{ paddingLeft: `${12 + row.depth * 16}px` }}
                        title={t.title}
                      >
                        <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                        {overdue && (
                          <span className="shrink-0 text-[10px] font-medium text-high">逾期</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {/* 右：时间轴（横向滚动） */}
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ width: totalWidth }}>
            {/* 刻度头 */}
            <div className="relative h-10 border-b border-line">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums text-ink-faint"
                  style={{ left: x(t) + 4 }}
                >
                  {tickLabel(t, zoom)}
                </span>
              ))}
              <span
                className="absolute top-0 h-full -translate-x-1/2 text-[10px] font-medium leading-10 text-accent"
                style={{ left: todayX }}
              >
                今日
              </span>
            </div>

            {/* 条区 */}
            <div className="relative" style={{ height: rows.length * ROW_H }}>
              {/* 周末底纹（仅日视图） */}
              {zoom === "day" &&
                ticks.map((t) => {
                  const dow = new Date(t).getDay();
                  if (dow !== 0 && dow !== 6) return null;
                  return (
                    <span
                      key={`w-${t}`}
                      className="absolute inset-y-0 bg-sunken/50"
                      style={{ left: x(t), width: pxPerDay }}
                    />
                  );
                })}
              {/* 刻度竖线 */}
              {ticks.map((t) => (
                <span
                  key={`g-${t}`}
                  className="absolute inset-y-0 w-px bg-line"
                  style={{ left: x(t) }}
                />
              ))}
              {/* 今日竖线（z-10 置于任务条之上，保证明显） */}
              <span
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent"
                style={{ left: todayX }}
                aria-hidden
              />

              {/* 行：任务条 / 里程碑菱形 */}
              {rows.map((row, i) => {
                if (row.kind === "milestone") {
                  const done = row.milestone.status === "done";
                  const d = parseDay(row.milestone.targetDate) ?? 0;
                  return (
                    <span
                      key={row.id}
                      className={`absolute h-3 w-3 -translate-x-1/2 rotate-45 ${
                        done ? "bg-done" : "bg-accent"
                      }`}
                      style={{ left: x(d), top: i * ROW_H + (ROW_H - 12) / 2 }}
                      title={row.milestone.title}
                    />
                  );
                }
                return (
                  <TaskBar
                    key={row.id}
                    task={row.task}
                    span={spanByTask.get(row.task.id)!}
                    top={i * ROW_H}
                    x={x}
                    todayMs={todayMs}
                    blockedBy={blockedBy}
                    selected={selectedId === row.task.id}
                    rowRef={rowRefs}
                    onOpen={() => onOpenTask(row.task)}
                  />
                );
              })}

              {/* 依赖箭头 */}
              {arrows.length > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={totalWidth}
                  height={rows.length * ROW_H}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id="ac-gantt-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
                    </marker>
                  </defs>
                  {arrows.map((a, i) => {
                    const dx = Math.min(24, Math.max(10, Math.abs(a.x2 - a.x1) / 2));
                    const d = `M ${a.x1} ${a.y1} C ${a.x1 + dx} ${a.y1}, ${a.x2 - dx} ${a.y2}, ${a.x2} ${a.y2}`;
                    return (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth={1.5}
                        markerEnd="url(#ac-gantt-arrow)"
                      />
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 右下角放大键：隐藏左栏、全宽呈现时间轴 */}
      <button
        type="button"
        onClick={() => setMaximized((v) => !v)}
        aria-pressed={maximized}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-field border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-pop transition hover:border-primary hover:text-primary"
      >
        {maximized ? "还原" : "放大"}
      </button>
    </div>
  );
}

function TaskBar({
  task,
  span,
  top,
  x,
  todayMs,
  blockedBy,
  selected,
  rowRef,
  onOpen,
}: {
  task: GanttTask;
  span: { start: number; end: number };
  top: number;
  x: (ms: number) => number;
  todayMs: number;
  blockedBy: Record<string, string[]>;
  selected: boolean;
  rowRef: React.MutableRefObject<Map<string, HTMLElement>>;
  onOpen: () => void;
}) {
  const blocked = (blockedBy[task.id] ?? []).length > 0;
  const overdue =
    task.status !== "done" && task.dueDate !== null && (parseDay(task.dueDate) ?? 0) < todayMs;
  const widthPx = Math.max(x(span.end) - x(span.start), 12);

  const statusCls = STATUS_BAR[task.status] ?? STATUS_BAR.todo;
  const ringCls = selected ? "ring-2 ring-primary" : overdue ? "ring-2 ring-high" : "";

  const rangeLabel = `${task.startDate ?? "…"} → ${task.dueDate ?? "…"}`;
  const tip = [
    task.title,
    `${STATUS_LABEL[task.status] ?? task.status} · ${rangeLabel}`,
    task.assigneeNames ?? "未分配",
    overdue ? "逾期" : null,
    blocked ? `等待前置任务：${blockedBy[task.id].join("、")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      ref={(el) => {
        if (el) rowRef.current.set(task.id, el);
        else rowRef.current.delete(task.id);
      }}
      onClick={onOpen}
      className="absolute"
      style={{ top, height: ROW_H }}
      title={tip}
    >
      <span
        className={`relative flex h-6 items-center gap-1 overflow-hidden rounded px-1 text-[11px] text-white ${statusCls} ${ringCls}`}
        style={{
          left: x(span.start),
          width: widthPx,
          top: (ROW_H - 24) / 2,
          ...(blocked ? BLOCKED_STYLE : {}),
        }}
      >
        {widthPx >= 24 && task.assigneeNames && (
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/25 text-[9px] font-semibold leading-none">
            {initials(task.assigneeNames.split("、")[0])}
          </span>
        )}
        {widthPx >= 56 && <span className="truncate">{task.title}</span>}
      </span>
    </button>
  );
}

function ZoomSwitch({
  zoom,
  onChange,
}: {
  zoom: Zoom;
  onChange: (z: Zoom) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-field border border-line bg-sunken p-0.5">
      {ZOOM_OPTIONS.map((z) => (
        <button
          key={z.key}
          type="button"
          onClick={() => onChange(z.key)}
          aria-pressed={zoom === z.key}
          className={`rounded px-2 py-0.5 text-xs transition ${
            zoom === z.key
              ? "bg-surface font-medium text-primary shadow-sm"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {z.label}
        </button>
      ))}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
