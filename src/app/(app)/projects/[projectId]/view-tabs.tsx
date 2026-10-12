"use client";

import { VIEWS, VIEW_LABEL, type ProjectView } from "./view-nav";
import { useViewNav } from "./use-view-nav";

export function ViewTabs({ projectId, view }: { projectId: string; view: ProjectView }) {
  const { go } = useViewNav(projectId);

  return (
    <div
      role="tablist"
      aria-label="项目视图"
      className="flex items-center gap-1 border-b border-line"
    >
      {VIEWS.map((v) => {
        const active = v === view;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              active
                ? "border-primary font-medium text-primary"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        );
      })}
    </div>
  );
}
