"use client";

import { useMemo } from "react";
import type { BoardTask } from "./board";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import { useFocusHighlight } from "./use-focus";
import { useViewNav } from "./use-view-nav";

const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

const STATUS_BADGE: Record<string, string> = {
  todo: "bg-todo text-white",
  doing: "bg-doing text-white",
  done: "bg-done text-white",
};

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

const STATUS_ORDER: Record<string, number> = { doing: 0, todo: 1, done: 2 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// 列表排序：状态（进行中→待办→已完成）→ 优先级（高→中→低）→ 截止日（早→晚，无截止日置尾）。
// dueDate 为 "YYYY-MM-DD" 字符串，字典序即时间序；空值用远端哨兵压到末尾。
function compareTasks(a: BoardTask, b: BoardTask): number {
  const s = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
  if (s !== 0) return s;
  const p = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
  if (p !== 0) return p;
  const da = a.dueDate ?? "9999-12-31";
  const db = b.dueDate ?? "9999-12-31";
  return da < db ? -1 : da > db ? 1 : 0;
}

export function ListView({ projectId, tasks }: { projectId: string; tasks: BoardTask[] }) {
  const sorted = useMemo(() => [...tasks].sort(compareTasks), [tasks]);

  return (
    <ul className="space-y-2">
      {sorted.map((t) => (
        <ListRow key={t.id} projectId={projectId} task={t} />
      ))}
    </ul>
  );
}

function ListRow({ projectId, task }: { projectId: string; task: BoardTask }) {
  const { go } = useViewNav(projectId);
  const { ref, focused } = useFocusHighlight<HTMLLIElement>(task.id);

  return (
    <li
      ref={ref}
      className={`ac-card flex items-center gap-3 p-3 text-sm transition ${
        focused ? "ring-2 ring-accent" : ""
      }`}
    >
      <span className={`ac-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.todo}`}>
        {STATUS_LABEL[task.status] ?? task.status}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assigneeNames ?? "未分配"}</span>
          {(task.startDate || task.dueDate) && (
            <span>· {task.startDate ?? "…"}→{task.dueDate ?? "…"}</span>
          )}
          <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.low}`}>
            {task.priority}
          </span>
          {task.labels.slice(0, 3).map((l) => (
            <span
              key={l.id}
              className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
            >
              {l.name}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-xs text-ink-faint">+{task.labels.length - 3}</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => go("gantt", task.id)}
        className="shrink-0 text-xs text-ink-faint hover:text-primary hover:underline"
      >
        在甘特中查看
      </button>
    </li>
  );
}
