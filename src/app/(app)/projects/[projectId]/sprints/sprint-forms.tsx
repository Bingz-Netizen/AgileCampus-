"use client";

import { useActionState } from "react";
import { closeSprintAction, createSprintAction, type SprintFormState } from "./actions";

export function SprintCreateForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<SprintFormState, FormData>(
    createSprintAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">新建迭代</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <input name="name" placeholder="迭代名称（如：最后一周收敛）" required className="ac-field flex-1 text-sm" />
        <input name="goal" placeholder="迭代目标（可选）" className="ac-field flex-1 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          起
          <input type="date" name="startDate" className="ac-field w-auto text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          止
          <input type="date" name="endDate" className="ac-field w-auto text-sm" />
        </label>
        <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
          {pending ? "创建中…" : "创建"}
        </button>
      </div>
      {state && "error" in state && <p className="text-sm text-high">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm text-done">已创建</p>}
    </form>
  );
}

export function CloseSprintButton({ projectId, sprintId }: { projectId: string; sprintId: string }) {
  const [state, formAction, pending] = useActionState<SprintFormState, FormData>(
    closeSprintAction,
    null,
  );
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sprintId" value={sprintId} />
      <button disabled={pending} className="text-xs text-ink-faint hover:text-high">
        {pending ? "关闭中…" : "关闭迭代"}
      </button>
      {state && "error" in state && <span className="ml-2 text-xs text-high">{state.error}</span>}
    </form>
  );
}
