"use client";

import { useEffect, useRef, useState } from "react";

// 成员多选下拉：点「分配任务」框弹出可滚动单列成员列表，每个成员名前一个勾选框。
// 选中值通过始终挂在 DOM 里的隐藏 input 提交（formData.getAll(name)），
// 关闭下拉后勾选结果仍随表单一起提交。
export function MemberPicker({
  name = "assigneeIds",
  members,
  defaultIds = [],
}: {
  name?: string;
  members: { id: string; name: string }[];
  defaultIds?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(() => [...defaultIds]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点选外部关闭下拉；勾选多个成员期间保持展开。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const label = selected.length
    ? members.filter((m) => selected.includes(m.id)).map((m) => m.name).join("、")
    : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ac-field flex items-center justify-between gap-2 text-left"
      >
        <span className={label ? "text-ink" : "text-ink-faint"}>
          {label ?? "分配任务"}
        </span>
        <span className="shrink-0 text-ink-faint">▾</span>
      </button>

      {/* 隐藏提交字段：始终在 DOM，保证关闭下拉后选中值仍被 formData 收集 */}
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-sunken"
            >
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={() => toggle(m.id)}
                className="accent-primary"
              />
              <span>{m.name}</span>
            </label>
          ))}
          {members.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-ink-faint">暂无成员</p>
          )}
        </div>
      )}
    </div>
  );
}
