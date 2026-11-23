"use client";

import { useState } from "react";

// 多人指派选择器：chip 形式的复选框，提交字段名 assigneeIds（可多值）。
// 新建任务与任务详情编辑共用；defaultSelected 供编辑态回填既有分派。
export function MemberPicker({
  members,
  defaultSelected = [],
}: {
  members: { id: string; name: string }[];
  defaultSelected?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (members.length === 0) {
    return <p className="text-xs text-ink-faint">团队暂无成员可指派</p>;
  }

  return (
    <fieldset>
      <legend className="mb-1 text-xs text-ink-faint">指派给（可多选）</legend>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const checked = selected.includes(m.id);
          return (
            <label
              key={m.id}
              className={`cursor-pointer rounded-field border px-2.5 py-1 text-sm transition-colors ${
                checked
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-line text-ink-soft hover:bg-sunken"
              }`}
            >
              <input
                type="checkbox"
                name="assigneeIds"
                value={m.id}
                checked={checked}
                onChange={() => toggle(m.id)}
                className="sr-only"
              />
              {m.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
