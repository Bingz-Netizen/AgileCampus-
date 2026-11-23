"use client";

import { useActionState, useState } from "react";
import { createTaskAction, type FormState } from "./actions";
import { MemberPicker } from "./member-picker";

export function NewTaskForm({
  projectId,
  members,
  milestones,
  sprints,
}: {
  projectId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
  sprints: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTaskAction,
    null,
  );
  // 类型切换：缺陷卡多出「严重级」一栏（估时/迭代为两者共用）
  const [kind, setKind] = useState<"feature" | "bug">("feature");

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">新建任务 / 缺陷</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <input name="title" placeholder="标题（缺陷卡写清复现路径）" className="ac-field" />
      <textarea name="description" placeholder="描述（可选）" rows={2} className="ac-field" />
      <MemberPicker members={members} />
      <div className="flex flex-wrap gap-2">
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as "feature" | "bug")}
          className="ac-field w-auto text-sm"
        >
          <option value="feature">功能任务</option>
          <option value="bug">缺陷卡</option>
        </select>
        {kind === "bug" && (
          <select name="bugSeverity" defaultValue="major" className="ac-field w-auto text-sm">
            <option value="blocker">阻断级</option>
            <option value="major">重要级</option>
            <option value="minor">优化级</option>
          </select>
        )}
        <select name="milestoneId" defaultValue="" className="ac-field w-auto text-sm">
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        {sprints.length > 0 && (
          <select name="sprintId" defaultValue="" className="ac-field w-auto text-sm">
            <option value="">未排入迭代</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select name="priority" defaultValue="medium" className="ac-field w-auto text-sm">
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          估时
          <input
            type="number"
            name="estimateHours"
            min="0.5"
            step="0.5"
            placeholder="h"
            className="ac-field w-20 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          起
          <input type="date" name="startDate" className="ac-field w-auto text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          止
          <input type="date" name="dueDate" className="ac-field w-auto text-sm" />
        </label>
      </div>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
        {pending ? "创建中…" : kind === "bug" ? "提交缺陷" : "创建任务"}
      </button>
    </form>
  );
}
