"use client";

import { useEffect, useState } from "react";
import type { OnboardingProgressView, OnboardingRoleType } from "@/lib/onboarding";
import { ROLE_DESC, ROLE_LABEL, STEP_CONTENT } from "./onboarding-content";

// 新手引导向导（居中弹窗 + 锚点聚光高亮）。三步差异化文案 + 进度点 + 上一步/下一步/跳过 + Esc 二次确认跳过。
// 进度写后端（PATCH /api/onboarding/progress），localStorage 仅由外层 Launcher 做会话缓存，本组件不落本地。

type AnchorRect = { top: number; left: number; width: number; height: number };

type Props = {
  initialProgress: OnboardingProgressView;
  startStep: number; // 0=身份选择，1..3=对应步骤
  hasProject: boolean;
  onClose: () => void; // 完成/跳过后关闭（外层负责刷新自身状态）
};

// 锚点缺失时自动降级为居中弹窗并记录原因，不阻塞、不报错（验收第 8 条）。
function locateAnchor(selector: string): AnchorRect | null {
  const el = document.querySelector(`[data-onboarding-anchor="${selector}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  if (r.bottom < 0 || r.top > window.innerHeight) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function OnboardingFlow({ initialProgress, startStep, hasProject, onClose }: Props) {
  const [step, setStep] = useState<number>(startStep);
  const [roleType, setRoleType] = useState<OnboardingRoleType | null>(
    initialProgress.roleType ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [anchor, setAnchor] = useState<{ rect: AnchorRect | null; missing: boolean }>({
    rect: null,
    missing: false,
  });

  const content = step >= 1 && step <= 3 ? STEP_CONTENT[step - 1] : null;

  // 步骤变化时尽力定位锚点；找不到则降级居中并记录原因。
  // 读 DOM（getBoundingClientRect）只能在挂载后 effect 里做，故此处对「外部系统同步」的 setState 显式豁免规则。
  useEffect(() => {
    const rect = content ? locateAnchor(content.anchor) : null;
    if (content && !rect) {
      console.info(`[onboarding] 锚点「${content.anchor}」不存在，跳过锚点定位，改用居中说明`);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchor({ rect, missing: content ? !rect : false });
  }, [content]);

  // Esc 等同「跳过引导」：无确认弹确认，已弹则取消（二次确认）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setConfirmSkip((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function save(
    patch: Partial<{ roleType: OnboardingRoleType; currentStep: number; status: string }>,
  ): Promise<OnboardingProgressView | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      return data.progress as OnboardingProgressView;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      return null;
    } finally {
      setPending(false);
    }
  }

  function goNext() {
    if (step === 0) {
      if (!roleType) {
        setError("请先选择身份");
        return;
      }
      void (async () => {
        const p = await save({ roleType, currentStep: 1, status: "in_progress" });
        if (p) setStep(1);
      })();
    } else if (step < 3) {
      void (async () => {
        const p = await save({ currentStep: step + 1 });
        if (p) setStep(step + 1);
      })();
    } else {
      // 第 3 步「下一步」进入完成页（不立即 completed，完成页再确认）
      setStep(4);
    }
  }

  function goBack() {
    if (step === 4) {
      setStep(3);
      return;
    }
    const target = step - 1;
    void (async () => {
      const p = await save({ currentStep: target });
      if (p) setStep(target);
    })();
  }

  function complete() {
    void (async () => {
      const p = await save({ status: "completed", currentStep: 3 });
      if (p) onClose();
    })();
  }

  function skip() {
    void (async () => {
      const p = await save({ status: "skipped" });
      if (p) onClose();
    })();
  }

  const anchorRect = anchor.rect;
  const anchorIsTop = anchorRect
    ? anchorRect.top + anchorRect.height / 2 < window.innerHeight / 2
    : false;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="新手引导">
      {/* 遮罩：无锚点时整屏压暗；有锚点时开孔聚光（box-shadow 外扩，孔内透明） */}
      {anchorRect ? (
        <div
          className="fixed z-0"
          style={{
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(26, 25, 19, 0.55)",
          }}
        >
          <div className="pointer-events-none absolute -inset-1.5 rounded-xl ring-2 ring-accent" />
        </div>
      ) : (
        <button
          type="button"
          aria-label="关闭"
          onClick={() => setConfirmSkip(true)}
          className="fixed inset-0 z-0 cursor-default bg-ink/50 backdrop-blur-sm"
        />
      )}

      {/* 卡片：有锚点时贴对侧（锚在上→卡在下，锚在下→卡在上），无锚点时居中 */}
      <div
        className={`fixed z-10 ${
          anchorRect
            ? anchorIsTop
              ? "inset-x-0 bottom-0 p-4"
              : "inset-x-0 top-0 p-4"
            : "inset-0 flex items-center justify-center p-4"
        }`}
      >
        <div className="mx-auto w-full max-w-lg ac-card p-6 shadow-pop">
          {step === 0 && (
            <WelcomeStep
              roleType={roleType}
              onSelect={setRoleType}
              onNext={goNext}
              onSkip={() => setConfirmSkip(true)}
              pending={pending}
            />
          )}
          {content && (
            <ContentStep
              content={content}
              roleType={roleType}
              hasProject={hasProject}
              anchorMissing={anchor.missing}
              onBack={goBack}
              onNext={goNext}
              onSkip={() => setConfirmSkip(true)}
              pending={pending}
            />
          )}
          {step === 4 && <CompleteStep onDone={complete} pending={pending} />}

          {error && <p className="mt-3 text-sm text-high">{error}</p>}
        </div>
      </div>

      {confirmSkip && (
        <ConfirmSkip
          onCancel={() => setConfirmSkip(false)}
          onConfirm={skip}
          pending={pending}
        />
      )}
    </div>
  );
}

function ProgressDots({ step }: { step: number }) {
  const active = Math.min(Math.max(step, 0), 3);
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n <= active ? "w-5 bg-primary" : "w-2 bg-line-strong"
          }`}
        />
      ))}
    </div>
  );
}

function WelcomeStep({
  roleType,
  onSelect,
  onNext,
  onSkip,
  pending,
}: {
  roleType: OnboardingRoleType | null;
  onSelect: (r: OnboardingRoleType) => void;
  onNext: () => void;
  onSkip: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4">
      <header className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">新手引导</p>
        <h2 className="mt-1 font-display text-xl font-semibold text-ink">欢迎使用 AgileCampus</h2>
        <p className="mt-1 text-sm text-ink-soft">三步上手：建项目 → 拆任务 → 用看板。</p>
      </header>

      <div className="space-y-2" role="radiogroup" aria-label="选择身份">
        {(["leader", "member"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={roleType === r}
            onClick={() => onSelect(r)}
            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
              roleType === r ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-primary"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{ROLE_LABEL[r]}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{ROLE_DESC[r]}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-ink-faint hover:text-ink"
        >
          跳过引导
        </button>
        <button type="button" onClick={onNext} disabled={pending} className="ac-btn">
          {pending ? "保存中…" : "开始引导"}
        </button>
      </div>
    </div>
  );
}

function ContentStep({
  content,
  roleType,
  hasProject,
  anchorMissing,
  onBack,
  onNext,
  onSkip,
  pending,
}: {
  content: (typeof STEP_CONTENT)[number];
  roleType: OnboardingRoleType | null;
  hasProject: boolean;
  anchorMissing: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  pending: boolean;
}) {
  const lines = roleType === "leader" ? content.leader : content.member;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="ac-badge bg-primary-soft text-primary">第 {content.number} 步</span>
          <span className="text-xs text-ink-faint">{ROLE_LABEL[roleType ?? "member"]}视角</span>
        </div>
        <h2 className="font-display text-xl font-semibold text-ink">{content.title}</h2>
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          {content.agile}
        </p>
      </header>

      <ul className="space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-soft">
            <span className="text-primary">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {content.key === "build_project" && (
        <p className="text-xs text-ink-faint">
          {hasProject
            ? "你已有项目，可打开「所有项目」进入。"
            : "你还没有项目，建议先前往「所有项目」创建或进入一个项目。"}{" "}
          <a
            href="/projects"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            前往「所有项目」↗
          </a>
        </p>
      )}

      {anchorMissing && (
        <p className="text-xs text-ink-faint">未在当前页面定位到目标位置，请按上方说明操作。</p>
      )}

      <ProgressDots step={content.number} />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-ink-faint hover:text-ink"
        >
          跳过引导
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} disabled={pending} className="ac-btn-ghost">
            上一步
          </button>
          <button type="button" onClick={onNext} disabled={pending} className="ac-btn">
            {pending ? "保存中…" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteStep({ onDone, pending }: { onDone: () => void; pending: boolean }) {
  return (
    <div className="space-y-4 text-center">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">引导完成</p>
        <h2 className="font-display text-xl font-semibold text-ink">你已经掌握三步上手 🎉</h2>
        <p className="text-sm text-ink-soft">建项目 · 拆任务 · 用看板。以后可在「设置 → 引导手册」随时重看。</p>
      </header>
      <button type="button" onClick={onDone} disabled={pending} className="ac-btn">
        {pending ? "保存中…" : "完成引导"}
      </button>
    </div>
  );
}

function ConfirmSkip({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="取消"
        onClick={onCancel}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm ac-card p-5 shadow-pop">
        <h3 className="font-display text-base font-semibold text-ink">跳过引导？</h3>
        <p className="mt-1 text-sm text-ink-soft">
          跳过后不再自动弹出，可在「设置 → 引导手册」重新开始。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="ac-btn-ghost">
            继续引导
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="ac-btn bg-high hover:bg-high"
          >
            {pending ? "保存中…" : "确认跳过"}
          </button>
        </div>
      </div>
    </div>
  );
}
