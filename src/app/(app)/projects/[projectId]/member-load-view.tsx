"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LoadLevel, MemberLoad, UrgentTask } from "@/lib/member-load";
import { withTask } from "./view-nav";

// 成员任务负载视图（仅 PC 端）：横向卡片 + 半圆仪表 + 最紧急 3 条 + 右侧抽屉。
// 交互全部走软导航（router.replace，scroll:false），复用既有看板筛选与 ?task 深链。

const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

const STATUS_BADGE: Record<string, string> = {
  todo: "bg-todo text-white",
  doing: "bg-doing text-white",
  done: "bg-done text-white",
};

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

// 复用项目既有语义色：绿=done、黄=medium、红=high（见 globals.css @theme）
const LEVEL_TONE: Record<LoadLevel, string> = {
  normal: "text-done",
  busy: "text-medium",
  overload: "text-high",
};

const LEVEL_LABEL: Record<LoadLevel, string> = {
  normal: "正常",
  busy: "较忙",
  overload: "过载",
};

export function MemberLoadView({
  projectId,
  members,
  today,
}: {
  projectId: string;
  members: MemberLoad[];
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // 当前 URL 仅筛了单一成员时高亮对应卡片，给点击筛选以反馈
  const activeAssignee = (() => {
    const ids = (searchParams.get("assignee") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length === 1 ? ids[0] : null;
  })();

  function filterMember(memberId: string) {
    const params = new URLSearchParams();
    params.set("assignee", memberId);
    params.set("view", "kanban");
    router.replace(`/projects/${projectId}?${params.toString()}`, { scroll: false });
  }

  function openTask(taskId: string) {
    const qs = withTask(new URLSearchParams(searchParams.toString()), taskId);
    router.replace(`/projects/${projectId}?${qs}`);
  }

  const drawer = members.find((m) => m.id === drawerId) ?? null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">成员负载</h2>
        <span className="text-xs text-ink-faint">
          绿 0–59 · 黄 60–79 · 红 80–100
        </span>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-ink-faint">暂无成员。</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {members.map((m) => (
            <MemberCard
              key={m.id}
              member={m}
              today={today}
              active={activeAssignee === m.id}
              onFilter={() => filterMember(m.id)}
              onOpenTask={openTask}
              onOpenDrawer={() => setDrawerId(m.id)}
            />
          ))}
        </div>
      )}

      {drawer && (
        <Drawer
          member={drawer}
          today={today}
          onOpenTask={openTask}
          onClose={() => setDrawerId(null)}
        />
      )}
    </section>
  );
}

function MemberCard({
  member,
  today,
  active,
  onFilter,
  onOpenTask,
  onOpenDrawer,
}: {
  member: MemberLoad;
  today: string;
  active: boolean;
  onFilter: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenDrawer: () => void;
}) {
  const level = member.loadLevel;
  const hasOverdue = member.overdueCount > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFilter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFilter();
        }
      }}
      className={`w-60 shrink-0 cursor-pointer rounded-xl border bg-surface p-4 shadow-sm transition hover:shadow-md ${
        hasOverdue ? "border-high" : "border-line"
      } ${active ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{member.name}</span>
        {hasOverdue && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-high"
            aria-label="有逾期任务"
            title={`${member.overdueCount} 项逾期`}
          />
        )}
      </div>

      <div className={`mt-3 flex flex-col items-center ${LEVEL_TONE[level]}`}>
        <Gauge score={member.loadScore} />
        <span className="mt-1 text-xs font-medium">{LEVEL_LABEL[level]}</span>
        <span className="text-xs text-ink-soft">
          {member.openCount} 项未完成{member.doneCount > 0 ? ` · ${member.doneCount} 项完成` : ""}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-line pt-3">
        {member.urgent.length === 0 ? (
          <p className="text-xs text-ink-faint">暂无待办</p>
        ) : (
          member.urgent.map((t) => (
            <TaskBar key={t.id} task={t} today={today} onOpen={() => onOpenTask(t.id)} />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDrawer();
        }}
        className="mt-3 w-full text-center text-xs text-ink-faint hover:text-primary hover:underline"
      >
        查看全部（{member.totalCount}）
      </button>
    </div>
  );
}

// 半圆仪表：180° 弧，按负载评分填充（0-100）；颜色随 loadLevel（由外层 text-* 类染色）。
function Gauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const d = "M 10 50 A 40 40 0 0 1 90 50";
  return (
    <div className="relative h-16 w-28" title={`负载 ${score} 分`}>
      <svg viewBox="0 0 100 60" className="h-full w-full" aria-hidden>
        <path
          d={d}
          fill="none"
          style={{ stroke: "var(--color-sunken)" }}
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={100}
        />
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - pct}
        />
      </svg>
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-lg font-semibold leading-none">
        {score}
      </span>
    </div>
  );
}

// 最紧急任务条框：任务名 + 截止时间 + 状态 + 优先级。逾期截止时间标红。
function TaskBar({
  task,
  today,
  onOpen,
}: {
  task: UrgentTask;
  today: string;
  onOpen: () => void;
}) {
  const overdue = task.status !== "done" && task.dueDate != null && task.dueDate < today;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="block w-full rounded-md border border-line bg-sunken px-2 py-1.5 text-left transition hover:border-primary"
    >
      <span className="block truncate text-xs font-medium text-ink">{task.title}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[0.6875rem] text-ink-soft">
        <span className={overdue ? "font-medium text-high" : ""}>截止 {task.dueDate ?? "未定"}</span>
        <span className={`ac-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.todo}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.low}`}>
          {task.priority}
        </span>
      </span>
    </button>
  );
}

function Drawer({
  member,
  today,
  onOpenTask,
  onClose,
}: {
  member: MemberLoad;
  today: string;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${member.name} 的任务`}>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <aside className="fixed inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col bg-surface shadow-pop">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-semibold text-ink">
              {member.name} 的任务
            </h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              共 {member.totalCount} 项 · {member.openCount} 项未完成
              {member.overdueCount > 0 && (
                <span className="text-high"> · {member.overdueCount} 项逾期</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {member.all.length === 0 ? (
            <li className="text-sm text-ink-faint">暂无任务。</li>
          ) : (
            member.all.map((t) => {
              const overdue = t.status !== "done" && t.dueDate != null && t.dueDate < today;
              const done = t.status === "done";
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTask(t.id);
                    }}
                    className={`block w-full rounded-lg border border-line bg-sunken px-3 py-2 text-left transition hover:border-primary ${
                      done ? "opacity-70" : ""
                    }`}
                  >
                    <span
                      className={`block truncate text-sm font-medium ${
                        done ? "text-ink-soft line-through" : "text-ink"
                      }`}
                    >
                      {t.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <span className={overdue ? "font-medium text-high" : ""}>
                        截止 {t.dueDate ?? "未定"}
                      </span>
                      <span className={`ac-badge ${STATUS_BADGE[t.status] ?? STATUS_BADGE.todo}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      <span className={`ac-badge ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.low}`}>
                        {t.priority}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>
    </div>
  );
}
