"use client";

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

export function ListView({ projectId, tasks }: { projectId: string; tasks: BoardTask[] }) {
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
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
          <span>{task.assigneeName ?? "未分配"}</span>
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
