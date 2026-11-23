"use client";

import { useActionState } from "react";
import { createRetroAction, type RetroFormState } from "./actions";

export function RetroForm({
  projectId,
  sprints,
}: {
  projectId: string;
  sprints: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<RetroFormState, FormData>(
    createRetroAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">记录一次复盘</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <input name="title" placeholder="复盘标题（如：最后一周收敛复盘）" required className="ac-field flex-1 text-sm" />
        <select name="sprintId" defaultValue="" className="ac-field w-auto text-sm">
          <option value="">不关联迭代</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-ink-faint">做得好的</span>
        <textarea name="wentWell" rows={2} className="ac-field text-sm" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-faint">待改进的</span>
        <textarea name="wentBad" rows={2} className="ac-field text-sm" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-faint">改进措施</span>
        <textarea name="improvements" rows={2} className="ac-field text-sm" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-faint">踩坑点</span>
        <textarea name="pitfalls" rows={2} className="ac-field text-sm" />
      </label>
      {state && "error" in state && <p className="text-sm text-high">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm text-done">已记录</p>}
      <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
        {pending ? "保存中…" : "保存复盘"}
      </button>
    </form>
  );
}
