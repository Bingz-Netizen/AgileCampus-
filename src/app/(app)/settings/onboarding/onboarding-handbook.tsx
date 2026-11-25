"use client";

import { useState } from "react";
import type { OnboardingProgressView, OnboardingRoleType } from "@/lib/onboarding";
import { OnboardingFlow } from "../../onboarding/onboarding-flow";
import {
  HANDBOOK_CONCEPTS,
  ONBOARDING_STEP_LABEL,
  ROLE_DESC,
  ROLE_LABEL,
  START_STEP_OPTIONS,
  STEP_CONTENT,
} from "../../onboarding/onboarding-content";

// 「引导手册」交互层：展示当前进度 + 三步简介 + 敏捷概念；开始/继续引导即拉起向导（重置进度走后端 restart）。

const STATUS_LABEL: Record<OnboardingProgressView["status"], string> = {
  not_started: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

const STATUS_TONE: Record<OnboardingProgressView["status"], string> = {
  not_started: "bg-low-soft text-low",
  in_progress: "bg-primary-soft text-primary",
  completed: "bg-done/12 text-done",
  skipped: "bg-medium-soft text-medium",
};

type FlowStart = {
  progress: OnboardingProgressView;
  step: number;
  hasProject: boolean;
};

export function OnboardingHandbook({
  initialProgress,
  hasProject,
}: {
  initialProgress: OnboardingProgressView;
  hasProject: boolean;
}) {
  const [progress, setProgress] = useState(initialProgress);
  const [roleType, setRoleType] = useState<OnboardingRoleType>(
    initialProgress.roleType ?? "leader",
  );
  const [startStep, setStartStep] = useState(0);
  const [flow, setFlow] = useState<FlowStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleType, startStep }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "开始失败");
      const next = data.progress as OnboardingProgressView;
      setProgress(next);
      setFlow({ progress: next, step: startStep, hasProject });
    } catch (e) {
      setError(e instanceof Error ? e.message : "开始失败");
    } finally {
      setBusy(false);
    }
  }

  function resume() {
    setFlow({
      progress,
      step: progress.currentStep,
      hasProject,
    });
  }

  async function refresh() {
    try {
      const res = await fetch("/api/onboarding/progress");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setProgress(data.progress as OnboardingProgressView);
    } catch {
      // 静默失败：保留旧进度展示
    }
  }

  const stepLabel =
    progress.status === "in_progress" ? ONBOARDING_STEP_LABEL[progress.currentStep] ?? "进行中" : "";

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">引导手册</h1>
        <p className="text-sm text-ink-soft">三步上手 AgileCampus：建项目 → 拆任务 → 用看板。</p>
      </header>

      {/* 当前进度 */}
      <section className="ac-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">当前进度</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {progress.status === "in_progress" && stepLabel
                ? `进行中（${stepLabel}）`
                : STATUS_LABEL[progress.status]}
            </p>
          </div>
          <span className={`ac-badge ${STATUS_TONE[progress.status]}`}>
            {STATUS_LABEL[progress.status]}
          </span>
        </div>

        {progress.status === "in_progress" && (
          <button type="button" onClick={resume} className="ac-btn-ghost mt-4">
            继续上次引导
          </button>
        )}
      </section>

      {/* 三步流程简介 */}
      <section className="ac-card p-5">
        <h2 className="font-display text-base font-semibold text-ink">三步流程</h2>
        <ol className="mt-3 space-y-2">
          {STEP_CONTENT.map((s) => (
            <li key={s.key} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                {s.number}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <p className="text-xs text-ink-soft">{s.agile}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 敏捷协作轻量概念 */}
      <section className="ac-card p-5">
        <h2 className="font-display text-base font-semibold text-ink">敏捷协作小概念</h2>
        <dl className="mt-3 space-y-2">
          {HANDBOOK_CONCEPTS.map((c) => (
            <div key={c.title} className="rounded-lg bg-sunken px-3 py-2">
              <dt className="text-xs font-semibold text-ink">{c.title}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-ink-soft">{c.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 开始引导 */}
      <section className="ac-card space-y-4 p-5">
        <h2 className="font-display text-base font-semibold text-ink">开始引导</h2>

        <div>
          <p className="text-sm font-medium text-ink">身份选择</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="身份选择">
            {(["leader", "member"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={roleType === r}
                onClick={() => setRoleType(r)}
                className={`flex items-start gap-2 rounded-lg border p-3 text-left transition ${
                  roleType === r ? "border-primary bg-primary-soft" : "border-line hover:border-primary"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{ROLE_DESC[r]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-ink">从哪一步开始</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {START_STEP_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setStartStep(o.value)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                  startStep === o.value ? "border-primary bg-primary-soft" : "border-line hover:border-primary"
                }`}
              >
                <span className="text-sm font-medium text-ink">{o.label}</span>
                <span className="text-xs text-ink-faint">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-high">{error}</p>}

        <button type="button" onClick={start} disabled={busy} className="ac-btn">
          {busy ? "启动中…" : "开始引导"}
        </button>
        <p className="text-xs text-ink-faint">
          重新开始只重置引导进度，不会删除你的项目、任务或评论。
        </p>
      </section>

      {flow && (
        <OnboardingFlow
          initialProgress={flow.progress}
          startStep={flow.step}
          hasProject={flow.hasProject}
          onClose={() => {
            setFlow(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
