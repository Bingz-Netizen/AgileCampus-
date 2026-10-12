"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import {
  addDependencyAction,
  deleteTaskAction,
  removeDependencyAction,
  updateTaskAction,
  type FormState,
  type UpdateTaskState,
} from "./actions";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import type { BoardTask } from "./board";
import { useFocusHighlight } from "./use-focus";
import { useViewNav } from "./use-view-nav";
import { TaskDiscussion } from "./task-comments";
import { TaskReadModal } from "./task-read-modal";

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
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
  blockedBy,
}: {
  task: BoardTask;
  projectId: string;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
  blockedBy: Record<string, string[]>;
}) {
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const searchParams = useSearchParams();
  // 深链 /projects/[id]?task=<taskId>：命中本卡片则打开详情弹窗（canWrite→编辑，只读→只读详情）。
  // 于渲染期调整而非 useEffect：避免多渲染一轮，且用户手动关闭后不会被 effect 重开。
  const deepLinked = searchParams.get("task") === task.id;
  const [prevDeepLinked, setPrevDeepLinked] = useState(false);
  if (deepLinked !== prevDeepLinked) {
    setPrevDeepLinked(deepLinked);
    if (deepLinked) {
      if (canWrite) setEditing(true);
      else setReading(true);
    }
  }
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite || editing,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);
  // 前置未完成 → 本卡灰化 + 锁图标，悬浮提示等待的前置任务
  const blockedTitles = blockedBy[task.id] ?? [];
  const blocked = blockedTitles.length > 0;

  const { go } = useViewNav(projectId);
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
        className={canWrite && !editing ? "cursor-grab" : ""}
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
          <span>{task.assigneeName ?? "未分配"}</span>
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
        {canWrite ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-ink-faint hover:text-primary hover:underline"
          >
            编辑
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setReading(true)}
            className="text-xs text-ink-faint hover:text-primary hover:underline"
          >
            详情
          </button>
        )}
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

      {editing && canWrite && (
        <EditModal
          task={task}
          projectId={projectId}
          members={members}
          milestones={milestones}
          allTasks={allTasks}
          allLabels={allLabels}
          dependencies={dependencies}
          onClose={() => setEditing(false)}
        />
      )}

      {reading && !canWrite && (
        <TaskReadModal task={task} members={members} onClose={() => setReading(false)} />
      )}
    </div>
  );
}

export function EditModal({
  task,
  projectId,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
  onClose,
}: {
  task: Omit<BoardTask, "commentCount">;
  projectId: string;
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
  onClose: () => void;
}) {
  const [updateState, updateFormAction, updating] = useActionState<UpdateTaskState, FormData>(
    updateTaskAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState<FormState, FormData>(
    deleteTaskAction,
    null,
  );
  const [addState, addFormAction, adding] = useActionState<FormState, FormData>(
    addDependencyAction,
    null,
  );
  const [removeState, removeFormAction, removing] = useActionState<FormState, FormData>(
    removeDependencyAction,
    null,
  );

  // 当前任务的前置任务（完成-开始依赖）；候选 = 同项目其他任务，排除自身与既有前置
  const predecessorIds = dependencies
    .filter((d) => d.successorId === task.id)
    .map((d) => d.predecessorId);
  const predecessors = predecessorIds
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is TaskOption => Boolean(t));
  const candidates = allTasks.filter(
    (t) => t.id !== task.id && !predecessorIds.includes(t.id),
  );

  // 保存成功（action 回 { ok: true }）即关窗
  useEffect(() => {
    if (updateState && "ok" in updateState) onClose();
  }, [updateState, onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateError = updateState && "error" in updateState ? updateState.error : null;
  const deleteError = deleteState && "error" in deleteState ? deleteState.error : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="编辑任务"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative z-10 my-auto w-full max-w-md ac-card p-5 shadow-pop">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-ink">编辑任务</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        <form action={updateFormAction} className="space-y-2.5">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectId" value={projectId} />

          <Field label="标题">
            <input name="title" defaultValue={task.title} className="ac-field text-sm" />
          </Field>
          <Field label="描述">
            <textarea
              name="description"
              defaultValue={task.description ?? ""}
              rows={2}
              className="ac-field text-sm"
              placeholder="任务描述"
            />
          </Field>
          <Field label="完成情况（完成时填写）">
            <textarea
              name="completionNote"
              defaultValue={task.completionNote ?? ""}
              rows={2}
              className="ac-field text-sm"
              placeholder="完成说明"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="负责人">
              <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className="ac-field text-sm">
                <option value="">未分配</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="里程碑">
              <select name="milestoneId" defaultValue={task.milestoneId ?? ""} className="ac-field text-sm">
                <option value="">无里程碑</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="优先级">
              <select name="priority" defaultValue={task.priority} className="ac-field text-sm">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </Field>
            <Field label="起始日">
              <input type="date" name="startDate" defaultValue={task.startDate ?? ""} className="ac-field text-sm" />
            </Field>
            <Field label="截止日">
              <input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className="ac-field text-sm" />
            </Field>
          </div>

          {allLabels.length > 0 && (
            <Field label="标签（可多选）">
              <select
                multiple
                name="labelIds"
                defaultValue={task.labels.map((l) => l.id)}
                className="ac-field text-sm"
                size={Math.min(4, Math.max(2, allLabels.length))}
              >
                {allLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {updateError && <p className="text-sm text-high">{updateError}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="ac-btn-ghost">
              取消
            </button>
            <button disabled={updating} className="ac-btn">
              {updating ? "保存中…" : "保存"}
            </button>
          </div>
        </form>

        <section className="mt-3 border-t border-line pt-3">
          <h4 className="mb-1.5 text-xs font-medium text-ink-soft">依赖（前置任务 · 完成-开始）</h4>
          {predecessors.length === 0 ? (
            <p className="text-xs text-ink-faint">暂无前置任务</p>
          ) : (
            <ul className="space-y-1">
              {predecessors.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{p.title}</span>
                  <form
                    action={removeFormAction}
                    onSubmit={(e) => {
                      if (!confirm(`确认删除前置依赖「${p.title}」？`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="predecessorId" value={p.id} />
                    <button
                      disabled={removing}
                      className="shrink-0 text-xs text-high underline disabled:opacity-50"
                    >
                      删除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {removeState?.error && <p className="mt-1 text-xs text-high">{removeState.error}</p>}

          <form action={addFormAction} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <select name="predecessorId" defaultValue="" className="ac-field text-sm">
              <option value="" disabled>
                选择前置任务…
              </option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button
              disabled={adding || candidates.length === 0}
              className="ac-btn shrink-0"
            >
              {adding ? "添加中…" : "添加"}
            </button>
          </form>
          {addState?.error && <p className="mt-1 text-xs text-high">{addState.error}</p>}
        </section>

        <form
          action={deleteFormAction}
          onSubmit={(e) => {
            if (!confirm("确认删除该任务？此操作不可恢复。")) e.preventDefault();
          }}
          className="mt-3 border-t border-line pt-3"
        >
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectId" value={projectId} />
          {deleteError && <p className="mb-1 text-xs text-high">{deleteError}</p>}
          <button
            disabled={deleting}
            className="text-xs text-high underline disabled:opacity-50"
          >
            删除任务
          </button>
        </form>

        <TaskDiscussion taskId={task.id} members={members} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
