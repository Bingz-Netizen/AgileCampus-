"use client";

import { useState, useTransition } from "react";
import { assignTasksAction } from "./actions";

// 迭代页：勾选未排期任务 → 一次性归入本迭代（D1「把剩余任务录入最后一轮迭代」）
export function AssignTasksForm({
  projectId,
  sprintId,
  tasks,
}: {
  projectId: string;
  sprintId: string;
  tasks: { id: string; title: string; status: string; kind: string; estimateHours: number | null }[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (tasks.length === 0) {
    return <p className="text-sm text-ink-faint">所有任务都已排入迭代。</p>;
  }

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const res = await assignTasksAction({ projectId, sprintId, taskIds: selected });
      if (res && "error" in res) setMessage({ kind: "error", text: res.error });
      else {
        setMessage({ kind: "ok", text: res?.message ?? "已加入本迭代" });
        setSelected([]);
      }
    });
  }

  return (
    <div className="space-y-2">
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {tasks.map((t) => (
          <li key={t.id}>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={() => toggle(t.id)}
              />
              <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
              {t.kind === "bug" && <span className="ac-badge bg-high-soft text-high">缺陷</span>}
              <span className="text-xs text-ink-faint">{t.estimateHours ? `${t.estimateHours}h` : "未估时"}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || selected.length === 0}
          className="ac-btn px-3 py-2 text-sm"
        >
          {pending ? "加入中…" : `加入本迭代（${selected.length}）`}
        </button>
        <button
          type="button"
          onClick={() => setSelected(tasks.map((t) => t.id))}
          className="text-xs text-ink-faint underline hover:text-primary"
        >
          全选
        </button>
        {message && (
          <span className={`text-xs ${message.kind === "ok" ? "text-done" : "text-high"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
