"use client";

import { useDraggable } from "@dnd-kit/core";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import type { BoardTask } from "./board";
import { useFocusHighlight } from "./use-focus";
import { useViewNav } from "./use-view-nav";

export type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

export function TaskCard({
  task,
  projectId,
  canWrite,
  allTasks,
  dependencies,
  blockedBy,
}: {
  task: BoardTask;
  projectId: string;
  canWrite: boolean;
  allTasks: TaskOption[];
  dependencies: { predecessorId: string; successorId: string }[];
  blockedBy: Record<string, string[]>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);
  // 前置未完成 → 本卡灰化 + 锁图标，悬浮提示等待的前置任务
  const blockedTitles = blockedBy[task.id] ?? [];
  const blocked = blockedTitles.length > 0;

  const { go, goTask } = useViewNav(projectId);
  const { ref: focusRef, focused } = useFocusHighlight<HTMLDivElement>(task.id);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        focusRef.current = node;
      }}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`ac-card p-3 text-sm transition hover:shadow-md ${
        isDragging ? "opacity-50" : ""
      } ${blocked ? "opacity-60" : ""} ${focused ? "ring-2 ring-accent" : ""}`}
    >
      <div
        {...listeners}
        {...attributes}
        className={canWrite ? "cursor-grab" : ""}
      >
        <p className="flex items-center gap-1.5 font-medium text-ink">
          {blocked && (
            <span
              title={`等待前置任务：${blockedTitles.join("、")}`}
              aria-label={`等待前置任务：${blockedTitles.join("、")}`}
              className="inline-flex shrink-0 text-ink-faint"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
          <span>{task.title}</span>
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assigneeNames ?? "未分配"}</span>
          {(task.startDate || task.dueDate) && (
            <span>· {task.startDate ?? "…"}→{task.dueDate ?? "…"}</span>
          )}
          <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>
            {task.priority}
          </span>
        </p>
        {task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
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
        )}
        {task.description && (
          <p className="mt-1 text-xs text-ink-soft line-clamp-2">{task.description}</p>
        )}
        {task.status === "done" && task.completionNote && (
          <p className="mt-1 rounded bg-done/10 px-2 py-1 text-xs text-done">
            完成情况：{task.completionNote}
          </p>
        )}
        {successorTitles.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => goTask(task.id)}
          className="text-xs text-ink-faint hover:text-primary hover:underline"
        >
          {canWrite ? "编辑" : "详情"}
        </button>
        <button
          type="button"
          onClick={() => go("gantt", task.id)}
          className="text-xs text-ink-faint hover:text-primary hover:underline"
        >
          在甘特中查看
        </button>
        <span
          title={`${task.commentCount} 条讨论`}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M3 3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1v3.5a.5.5 0 0 0 .85.36L8.2 14H16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3Zm11 5.5a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 .75.75Zm-.75 3.25a.75.75 0 0 0 0-1.5H9.5a.75.75 0 0 0 0 1.5h3.75Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{task.commentCount}</span>
        </span>
      </div>
    </div>
  );
}
