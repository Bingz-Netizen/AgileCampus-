"use client";

import { useState, useTransition, useActionState, type FormEvent } from "react";
import {
  updateRetroAction,
  deleteRetroAction,
  type RetroFormState,
} from "./actions";

export type RetroItem = {
  id: string;
  title: string;
  wentWell: string | null;
  wentBad: string | null;
  improvements: string | null;
  pitfalls: string | null;
  sprintId: string | null;
  sprintName: string | null;
  authorName: string | null;
  createdAtLabel: string;
  canManage: boolean;
};

const FIELDS = [
  ["wentWell", "做得好的"],
  ["wentBad", "待改进的"],
  ["improvements", "改进措施"],
  ["pitfalls", "踩坑点"],
] as const;

export function RetroCard({
  projectId,
  retro,
  sprints,
}: {
  projectId: string;
  retro: RetroItem;
  sprints: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteState, deleteFormAction, deleting] = useActionState<RetroFormState, FormData>(
    deleteRetroAction,
    null,
  );

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateRetroAction(null, formData);
      if (res && "error" in res) setEditError(res.error);
      else setEditing(false);
    });
  }

  return (
    <article className="ac-card space-y-2 p-4">
      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="retroId" value={retro.id} />
          <div className="flex flex-wrap gap-2">
            <input
              name="title"
              defaultValue={retro.title}
              required
              className="ac-field flex-1 text-sm"
            />
            <select name="sprintId" defaultValue={retro.sprintId ?? ""} className="ac-field w-auto text-sm">
              <option value="">不关联迭代</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {FIELDS.map(([name, label]) => (
            <label key={name} className="block space-y-1">
              <span className="text-xs text-ink-faint">{label}</span>
              <textarea
                name={name}
                defaultValue={retro[name] ?? ""}
                rows={2}
                className="ac-field text-sm"
              />
            </label>
          ))}
          {editError && <p className="text-sm text-high">{editError}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className="ac-btn px-3 py-2 text-sm">
              {pending ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="ac-btn-ghost px-3 py-2 text-sm"
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-ink">{retro.title}</h3>
            <span className="text-xs text-ink-faint">
              {retro.sprintName ? `${retro.sprintName} · ` : ""}
              {retro.authorName ?? "已注销用户"} · {retro.createdAtLabel}
            </span>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {FIELDS.map(([name, label]) => {
              const value = retro[name];
              return value ? (
                <div key={name}>
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="whitespace-pre-wrap text-ink">{value}</dd>
                </div>
              ) : null;
            })}
          </dl>
          {retro.canManage && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs text-ink-faint hover:text-primary hover:underline"
              >
                修改
              </button>
              <form
                action={deleteFormAction}
                onSubmit={(e) => {
                  if (!confirm("确认删除这条复盘记录？")) e.preventDefault();
                }}
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="retroId" value={retro.id} />
                <button
                  disabled={deleting}
                  className="text-xs text-high underline disabled:opacity-50"
                >
                  删除
                </button>
              </form>
            </div>
          )}
          {deleteState && "error" in deleteState && (
            <p className="text-sm text-high">{deleteState.error}</p>
          )}
        </>
      )}
    </article>
  );
}
