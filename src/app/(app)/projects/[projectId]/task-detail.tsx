"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addDependencyAction,
  deleteTaskAction,
  removeDependencyAction,
  updateTaskAction,
  type FormState,
  type UpdateTaskState,
} from "./actions";
import { MemberPicker } from "./member-picker";
import { TaskDiscussion } from "./task-comments";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import { withoutTask } from "./view-nav";
import { TaskReview, type AnnotationItem } from "./task-review";

export type TaskDetailTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done" | "review" | "rejected";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeIds: string[];
  assigneeNames: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
  // 最后一周：迭代 / 缺陷卡 / 估时 / 阻塞
  sprintId: string | null;
  kind: "feature" | "bug";
  bugSeverity: "blocker" | "major" | "minor" | null;
  bugStatus: "open" | "fixing" | "fixed" | "verified" | null;
  relatedTaskId: string | null;
  estimateHours: number | null;
  blocked: boolean;
  blockedReason: string | null;
};

const BUG_SEVERITY_LABEL: Record<string, string> = {
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

const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  review: "待评审",
  rejected: "已退回",
  done: "已完成",
};
const STATUS_BADGE: Record<string, string> = {
  todo: "bg-todo text-white",
  doing: "bg-doing text-white",
  review: "bg-medium-soft text-medium",
  rejected: "bg-high-soft text-high",
  done: "bg-done text-white",
};
const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

// 任务详情内嵌视图：?task=<taskId> 时整页替换项目页。
// 可写成员（admin/student）见到编辑表单、前置依赖与删除；teacher 为只读，仅可参与讨论。
export function TaskDetail({
  projectId,
  task,
  canWrite,
  viewerId,
  viewerRole,
  members,
  milestones,
  sprints,
  allTasks,
  allLabels,
  dependencies,
  annotations,
}: {
  projectId: string;
  task: TaskDetailTask;
  canWrite: boolean;
  viewerId: string;
  viewerRole: "admin" | "teacher" | "student" | "leader";
  members: { id: string; name: string }[];
  milestones: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  allTasks: { id: string; title: string }[];
  allLabels: { id: string; name: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
  annotations: AnnotationItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<"feature" | "bug">(task.kind);

  const [updateState, updateAction, updatePending] = useActionState<UpdateTaskState, FormData>(
    updateTaskAction,
    null,
  );
  const [depState, depAction, depPending] = useActionState<FormState, FormData>(
    addDependencyAction,
    null,
  );
  const [rmState, rmAction, rmPending] = useActionState<FormState, FormData>(
    removeDependencyAction,
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 前置任务：本任务是 successor；后置任务仅作展示，供理解依赖链
  const predecessors = dependencies.filter((d) => d.successorId === task.id);
  const successorIds = new Set(
    dependencies.filter((d) => d.predecessorId === task.id).map((d) => d.successorId),
  );
  const predecessorIds = new Set(predecessors.map((d) => d.predecessorId));
  const candidates = allTasks.filter(
    (t) => t.id !== task.id && !predecessorIds.has(t.id) && !successorIds.has(t.id),
  );

  function back() {
    const qs = withoutTask(new URLSearchParams(searchParams.toString()));
    router.replace(`/projects/${projectId}${qs ? `?${qs}` : ""}`);
  }

  async function handleDelete(formData: FormData) {
    if (!window.confirm("确定删除该任务？删除后不可恢复。")) return;
    setDeleteError(null);
    const res = await deleteTaskAction(null, formData);
    if (res?.error) setDeleteError(res.error);
    else back();
  }

  return (
    <div className="space-y-6">
      <section className="ac-card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`ac-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.todo}`}>
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
          <span className="ac-badge bg-sunken text-ink-soft">
            优先级 {PRIORITY_LABEL[task.priority] ?? task.priority}
          </span>
          {task.kind === "bug" && (
            <span className="ac-badge bg-high-soft text-high">
              缺陷 · {BUG_SEVERITY_LABEL[task.bugSeverity ?? "major"] ?? "重要级"} ·{" "}
              {BUG_STATUS_LABEL[task.bugStatus ?? "open"] ?? "待处理"}
            </span>
          )}
          {task.blocked && <span className="ac-badge bg-high-soft text-high">已阻塞</span>}
          {task.estimateHours !== null && (
            <span className="ac-badge bg-sunken text-ink-soft">估时 {task.estimateHours}h</span>
          )}
          <span className="text-ink-soft">
            负责人：{task.assigneeNames ?? "未分配"}
          </span>
          <span className="text-xs text-ink-faint">
            {task.startDate ?? "…"} → {task.dueDate ?? "…"}
          </span>
        </div>

        {task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.map((l) => (
              <span
                key={l.id}
                className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}

        {canWrite ? (
          <form action={updateAction} className="space-y-2">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />

            <label className="block space-y-1">
              <span className="text-xs text-ink-faint">标题</span>
              <input
                name="title"
                defaultValue={task.title}
                required
                className="ac-field text-sm"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-ink-faint">描述</span>
              <textarea
                name="description"
                defaultValue={task.description ?? ""}
                rows={3}
                className="ac-field text-sm"
              />
            </label>

            <MemberPicker members={members} defaultSelected={task.assigneeIds} />

            <div className="flex flex-wrap gap-2">
              <select
                name="milestoneId"
                defaultValue={task.milestoneId ?? ""}
                className="ac-field w-auto text-sm"
              >
                <option value="">无里程碑</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                name="priority"
                defaultValue={task.priority}
                className="ac-field w-auto text-sm"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-ink-faint">
                起
                <input
                  type="date"
                  name="startDate"
                  defaultValue={task.startDate ?? ""}
                  className="ac-field w-auto text-sm"
                />
              </label>
              <label className="flex items-center gap-1 text-sm text-ink-faint">
                止
                <input
                  type="date"
                  name="dueDate"
                  defaultValue={task.dueDate ?? ""}
                  className="ac-field w-auto text-sm"
                />
              </label>
            </div>

            {/* 最后一周：迭代归属 + 类型 + 估时 + 阻塞标记 */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                name="sprintId"
                defaultValue={task.sprintId ?? ""}
                className="ac-field w-auto text-sm"
              >
                <option value="">未排入迭代</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "feature" | "bug")}
                className="ac-field w-auto text-sm"
              >
                <option value="feature">功能任务</option>
                <option value="bug">缺陷卡</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-ink-faint">
                估时
                <input
                  type="number"
                  name="estimateHours"
                  min="0.5"
                  step="0.5"
                  defaultValue={task.estimateHours ?? ""}
                  placeholder="h"
                  className="ac-field w-20 text-sm"
                />
              </label>
              <label className="flex items-center gap-1 text-sm text-ink-faint">
                <input type="checkbox" name="blocked" defaultChecked={task.blocked} />
                阻塞
              </label>
              <input
                name="blockedReason"
                defaultValue={task.blockedReason ?? ""}
                placeholder="阻塞原因（站会同步用）"
                className="ac-field w-48 text-sm"
              />
            </div>

            {kind === "bug" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-high-soft/40 p-2">
                <select
                  name="bugSeverity"
                  defaultValue={task.bugSeverity ?? "major"}
                  className="ac-field w-auto text-sm"
                >
                  <option value="blocker">阻断级</option>
                  <option value="major">重要级</option>
                  <option value="minor">优化级</option>
                </select>
                <select
                  name="bugStatus"
                  defaultValue={task.bugStatus ?? "open"}
                  className="ac-field w-auto text-sm"
                >
                  <option value="open">待处理</option>
                  <option value="fixing">处理中</option>
                  <option value="fixed">已修复</option>
                  <option value="verified">验证通过</option>
                </select>
                <select
                  name="relatedTaskId"
                  defaultValue={task.relatedTaskId ?? ""}
                  className="ac-field w-auto text-sm"
                >
                  <option value="">关联任务（可选）</option>
                  {allTasks
                    .filter((t) => t.id !== task.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {allLabels.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-xs text-ink-faint">标签</legend>
                <div className="flex flex-wrap gap-3">
                  {allLabels.map((l) => (
                    <label key={l.id} className="flex items-center gap-1 text-sm text-ink-soft">
                      <input
                        type="checkbox"
                        name="labelIds"
                        value={l.id}
                        defaultChecked={task.labels.some((x) => x.id === l.id)}
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {task.status === "done" && (
              <label className="block space-y-1">
                <span className="text-xs text-ink-faint">完成情况</span>
                <textarea
                  name="completionNote"
                  defaultValue={task.completionNote ?? ""}
                  rows={2}
                  className="ac-field text-sm"
                />
              </label>
            )}

            {updateState && "error" in updateState && (
              <p className="text-sm text-high">{updateState.error}</p>
            )}
            {updateState && "ok" in updateState && (
              <p className="text-sm text-done">已保存</p>
            )}

            <div className="flex items-center gap-2">
              <button disabled={updatePending} className="ac-btn px-3 py-2 text-sm">
                {updatePending ? "保存中…" : "保存"}
              </button>
              <button type="button" onClick={back} className="ac-btn-ghost">
                返回项目
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            {task.description && (
              <p className="whitespace-pre-wrap text-sm text-ink">{task.description}</p>
            )}
            {task.status === "done" && task.completionNote && (
              <p className="rounded bg-done/10 px-2 py-1 text-xs text-done">
                完成情况：{task.completionNote}
              </p>
            )}
          </div>
        )}
      </section>

      <TaskReview
        projectId={projectId}
        taskId={task.id}
        status={task.status}
        canSubmit={
          viewerRole !== "teacher" &&
          task.assigneeIds.includes(viewerId) &&
          (task.status === "doing" || task.status === "rejected")
        }
        canApprove={viewerRole === "admin" || viewerRole === "teacher"}
        canReject={viewerRole === "admin" || viewerRole === "teacher" || viewerRole === "leader"}
        annotations={annotations}
      />

      {canWrite && (
        <section className="ac-card space-y-2 p-4">
          <h2 className="font-medium text-ink">前置任务</h2>
          {predecessors.length === 0 ? (
            <p className="text-sm text-ink-faint">暂无前置任务</p>
          ) : (
            <ul className="space-y-1">
              {predecessors.map((d) => {
                const title = allTasks.find((t) => t.id === d.predecessorId)?.title ?? "已删除任务";
                return (
                  <li key={d.predecessorId} className="flex items-center gap-2 text-sm">
                    <span className="text-ink">{title}</span>
                    <form action={rmAction} className="inline">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="predecessorId" value={d.predecessorId} />
                      <button disabled={rmPending} className="text-xs text-ink-faint hover:text-high">
                        移除
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          <form action={depAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <select
              name="predecessorId"
              defaultValue=""
              required
              className="ac-field w-auto text-sm"
              disabled={candidates.length === 0}
            >
              <option value="" disabled>
                {candidates.length === 0 ? "无可添加的任务" : "选择前置任务…"}
              </option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button disabled={depPending || candidates.length === 0} className="ac-btn-ghost">
              添加前置
            </button>
          </form>

          {depState?.error && <p className="text-sm text-high">{depState.error}</p>}
          {rmState?.error && <p className="text-sm text-high">{rmState.error}</p>}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-ink">讨论</h2>
        <TaskDiscussion
          taskId={task.id}
          viewerId={viewerId}
          viewerRole={viewerRole}
          members={members}
        />
      </section>

      {canWrite && (
        <section className="ac-card space-y-2 border-line p-4">
          <h2 className="font-medium text-high">危险操作</h2>
          <form action={handleDelete}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <button className="ac-btn-ghost text-high">删除任务</button>
          </form>
          {deleteError && <p className="text-sm text-high">{deleteError}</p>}
        </section>
      )}
    </div>
  );
}
