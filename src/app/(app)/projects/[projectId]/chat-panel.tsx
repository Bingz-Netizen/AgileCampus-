"use client";

import { useEffect, useRef, useState } from "react";
import { DraftCards, type Draft } from "./draft-cards";

type Option = { id: string; name: string };
type Msg = { role: "user" | "assistant"; content: string; drafts?: Draft[] };

const POS_KEY = "agilecampus:chat-panel-pos";
const PANEL_W = 380;
const PANEL_H = 560;

type Pos = { x: number; y: number };

function readPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pos;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

// 项目助手：右下角悬浮球，点击展开可拖动的对话窗。
// 聊天记录来自服务端（每项目最近一条会话），刷新页面也能接着聊；窗口位置记在 localStorage。
export function ChatPanel({
  projectId,
  initialMessages,
  members,
  milestones,
}: {
  projectId: string;
  initialMessages: Msg[];
  members: Option[];
  milestones: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number; dragging: boolean }>({
    dx: 0,
    dy: 0,
    dragging: false,
  });

  // 首次挂载：恢复上次位置；没有则贴右下角
  useEffect(() => {
    const saved = readPos();
    if (saved) {
      setPos(saved);
      return;
    }
    const w = Math.min(PANEL_W, window.innerWidth - 32);
    const h = Math.min(PANEL_H, window.innerHeight - 120);
    setPos({ x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 });
  }, []);

  // 新消息或展开时滚到底
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages, pending]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      dragging: true,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging || !panelRef.current) return;
    const w = panelRef.current.offsetWidth;
    const h = panelRef.current.offsetHeight;
    const x = Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - w - 8);
    const y = Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - h - 8);
    setPos({ x, y });
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setPos((p) => {
      if (p) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          // 隐私模式下 localStorage 可能不可写，忽略即可
        }
      }
      return p;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, userText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "对话失败");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.text, drafts: data.drafts }]);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  const width = `min(${PANEL_W}px, calc(100vw - 32px))`;
  const height = `min(${PANEL_H}px, calc(100vh - 140px))`;

  return (
    <>
      {/* 悬浮球 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "收起项目助手" : "打开项目助手"}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {open ? "×" : "AI"}
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          style={{ left: pos.x, top: pos.y, width, height }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        >
          {/* 标题栏：可拖动 */}
          <div
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-line bg-sunken px-3 py-2 active:cursor-grabbing"
            title="拖动移动窗口"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">项目助手</p>
              <p className="truncate text-[11px] text-ink-faint">
                拖动标题栏可移动 · 记录会自动保存
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded px-2 py-1 text-xs text-ink-faint hover:bg-line hover:text-ink"
              aria-label="收起"
            >
              收起
            </button>
          </div>

          {/* 消息区 */}
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="space-y-1 text-sm text-ink-soft">
                <p>向助手提问，比如：</p>
                <p>· 当前进度如何？</p>
                <p>· 把「用户调研」拆成任务</p>
                <p>· 谁的任务最多？</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div
                  className={`rounded-lg p-2.5 text-sm ${
                    m.role === "user" ? "bg-sunken" : "bg-primary-soft"
                  }`}
                >
                  <span className="mr-2 text-xs text-ink-faint">
                    {m.role === "user" ? "我" : "助手"}
                  </span>
                  <span className="whitespace-pre-wrap text-ink">{m.content}</span>
                </div>
                {m.drafts && m.drafts.length > 0 && (
                  <DraftCards
                    projectId={projectId}
                    drafts={m.drafts}
                    members={members}
                    milestones={milestones}
                  />
                )}
              </div>
            ))}
            {pending && <p className="text-xs text-ink-faint">助手正在思考…</p>}
          </div>

          {error && (
            <p className="border-t border-line px-3 py-2 text-xs text-high">{error}</p>
          )}

          {/* 输入区 */}
          <div className="flex gap-2 border-t border-line p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
              placeholder="问点什么…"
              className="ac-field flex-1 text-sm"
              disabled={pending}
            />
            <button onClick={send} disabled={pending} className="ac-btn px-3 py-2 text-sm">
              {pending ? "…" : "发送"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
