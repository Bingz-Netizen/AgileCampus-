"use client";

import { useState } from "react";

/** 团队邀请码：默认收起，点开才显示，并附带一键复制。 */
export function InviteCode({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板被拒绝（http 非安全上下文）时保持静默，不打断用户
    }
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-ink-faint transition-colors hover:text-primary"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        邀请码
      </button>
      {open ? (
        <>
          <code className="font-mono tracking-wide text-ink-soft">{code}</code>
          <button
            type="button"
            onClick={copy}
            className="text-ink-faint transition-colors hover:text-primary"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </>
      ) : (
        <span className="text-ink-faint/70">••••••</span>
      )}
    </div>
  );
}
