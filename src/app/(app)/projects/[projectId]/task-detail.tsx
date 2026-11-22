"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  addDependencyAction,
  deleteTaskAction,
  removeDependencyAction,
  updateTaskAction,
  type FormState,
  type UpdateTaskState,
} from "./actions";
import { TaskDiscussion } from "./task-comments";
import { MemberPicker } from "./member-picker";

type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };

export type TaskDetailTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeIds: string[];
  assigneeNames: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
};

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };
const STATUS_BADGE: Record<string, string> = {
  todo: "bg-todo text-white",
  doing: "bg-doing text-white",
  done: "bg-done text-white",
};
const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

// 任务详情整页视图：替代原弹窗（看板编辑弹窗 + 只读详情弹窗）。
// canWrite → 编辑表单 + 依赖 + 删除 + 讨论；只读 → 字段展示 + 讨论。
export function TaskDetail({
  projectId,
  task,
  canWrite,
  viewerId,
  viewerRole,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  projectId: string;
  task: TaskDetailTask;
  canWrite: boolean;
  viewerId: string;
  viewerRole: "admin" | "teacher" | "student";
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  if (!canWrite)
    return <ReadPanel task={task} viewerId={viewerId} viewerRole={viewerRole} members={members} />;
  return (
    <EditPanel
      projectId={projectId}
      task={task}
      viewerId={viewerId}
      viewerRole={viewerRole}
      members={members}
      milestones={milestones}
      allTasks={allTasks}
      allLabels={allLabels}
      dependencies={dependencies}
    />
  );
}

function EditPanel({
  projectId,
  task,
  viewerId,
  viewerRole,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  projectId: string;
  task: TaskDetailTask;
  viewerId: string;
  viewerRole: "admin" | "teacher" | "student";
  members: Option[];
  milestones: Option[];
  allTasks: TaskOption[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const router = useRouter();
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

  // 保存成功（action 回 { ok: true }）即刷新本页，让标题/元信息反映最新值
  useEffect(() => {
    if (updateState && "ok" in updateState) router.refresh();
  }, [updateState, router]);

  // 删除成功（回 null 且由 pending→idle）后返回项目页：任务已不存在，留在详情页无意义
  const prevDeleting = useRef(false);
  useEffect(() => {
    const justFinished = prevDeleting.current && !deleting;
    prevDeleting.current = deleting;
    if (justFinished && deleteState === null) router.replace(`/projects/${projectId}`);
  }, [deleting, deleteState, projectId, router]);

  const updateError = updateState && "error" in updateState ? updateState.error : null;
  const deleteError = deleteState && "error" in deleteState ? deleteState.error : null;

  return (
    <div className="ac-card p-5 shadow-pop">
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
            <MemberPicker members={members} defaultIds={task.assigneeIds} />
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

      <TaskDiscussion taskId={task.id} viewerId={viewerId} viewerRole={viewerRole} members={members} />
    </div>
  );
}

// 只读任务详情：teacher 等只读成员查看任务字段并参与讨论（无编辑/依赖/删除入口）。
function ReadPanel({
  task,
  viewerId,
  viewerRole,
  members,
}: {
  task: TaskDetailTask;
  viewerId: string;
  viewerRole: "admin" | "teacher" | "student";
  members: Option[];
}) {
  return (
    <div className="ac-card p-5 shadow-pop">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <span className={`ac-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.todo}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        <span className="ac-badge bg-sunken text-ink-soft">
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </span>
        <span>负责人：{task.assigneeNames ?? "未分配"}</span>
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
        <TaskDiscussion taskId={task.id} viewerId={viewerId} viewerRole={viewerRole} members={members} />
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
