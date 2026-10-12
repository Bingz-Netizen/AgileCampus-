"use client";

import { useEffect } from "react";
import type { BoardTask } from "./board";
import { TaskDiscussion } from "./task-comments";

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };
const STATUS_BADGE: Record<string, string> = {
  todo: "bg-todo text-white",
  doing: "bg-doing text-white",
  done: "bg-done text-white",
};
const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

// 只读任务详情弹窗：teacher 等只读成员可查看任务与参与讨论（无编辑/依赖/删除入口）。
export function TaskReadModal({
  task,
  members,
  onClose,
}: {
  task: BoardTask;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="任务详情"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative z-10 my-auto w-full max-w-md ac-card p-5 shadow-pop">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-ink">{task.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span className={`ac-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.todo}`}>
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
          <span className="ac-badge bg-sunken text-ink-soft">
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </span>
          <span>负责人：{task.assigneeName ?? "未分配"}</span>
        </div>
        {(task.startDate || task.dueDate) && (
          <p className="mt-1 text-xs text-ink-faint">
            {task.startDate ?? "…"} → {task.dueDate ?? "…"}
          </p>
        )}
        {task.description && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{task.description}</p>
        )}
        {task.status === "done" && task.completionNote && (
          <p className="mt-2 rounded bg-done/10 px-2 py-1 text-xs text-done">
            完成情况：{task.completionNote}
          </p>
        )}

        <div className="mt-3">
          <TaskDiscussion taskId={task.id} members={members} />
        </div>
      </div>
    </div>
  );
}
