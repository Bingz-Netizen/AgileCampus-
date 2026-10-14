"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommentAttachment } from "@/db/schema";

type Member = { id: string; name: string };
type ViewerRole = "admin" | "teacher" | "student";
type ImportanceType = "decision" | "issue" | "delivery" | "reference";

type CommentDto = {
  id: string;
  userId: string;
  authorName: string | null;
  parentId: string | null;
  content: string;
  mentions: string[];
  attachments: CommentAttachment[];
  isImportant: boolean;
  importanceType: ImportanceType | null;
  editedAt: string | null;
  editCount: number;
  deletedAt: string | null;
  createdAt: string;
};

type ActivityDto = {
  id: string;
  type: "status_changed" | "dependency_added" | "dependency_removed" | "comment_deleted";
  payload: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
};

type EditDto = {
  id: string;
  oldContent: string;
  newContent: string;
  editorName: string | null;
  createdAt: string;
};

type TimelineItem =
  | { kind: "comment"; comment: CommentDto }
  | { kind: "activity"; activity: ActivityDto };

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };

const IMPORTANCE_LABEL: Record<string, string> = {
  decision: "决策",
  issue: "问题",
  delivery: "交付",
  reference: "参考",
};
const IMPORTANCE_BADGE: Record<string, string> = {
  decision: "bg-primary-soft text-primary",
  issue: "bg-high-soft text-high",
  delivery: "bg-low-soft text-low",
  reference: "bg-medium-soft text-medium",
};

const MAX_FILE = 3 * 1024 * 1024; // 单附件 3MB（dataURL 内联，MVP 上限）

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// 任务讨论区：评论 + 回复 + @成员 + 附件 + 时间线（合并状态/依赖/删除变更）。
// 重要标记（仅 admin/teacher）、编辑（仅作者）、删除（作者或 admin/teacher）在 lib 层二次校验。
export function TaskDiscussion({
  taskId,
  viewerId,
  viewerRole,
  members,
}: {
  taskId: string;
  viewerId: string;
  viewerRole: ViewerRole;
  members: Member[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<CommentDto | null>(null);
  const [pending, setPending] = useState(false);
  const [onlyImportant, setOnlyImportant] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const canMark = viewerRole === "admin" || viewerRole === "teacher";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, a] = await Promise.all([
          fetch(`/api/tasks/${taskId}/comments`).then((r) => r.json()),
          fetch(`/api/tasks/${taskId}/activities`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const comments: CommentDto[] = c.comments ?? [];
        const activities: ActivityDto[] = a.activities ?? [];
        const merged: TimelineItem[] = [
          ...comments.map((comment) => ({ kind: "comment" as const, comment })),
          ...activities.map((activity) => ({ kind: "activity" as const, activity })),
        ].sort(
          (x, y) =>
            new Date((x.kind === "comment" ? x.comment : x.activity).createdAt).getTime() -
            new Date((y.kind === "comment" ? y.comment : y.activity).createdAt).getTime(),
        );
        setItems(merged);
      } catch {
        if (!cancelled) setError("加载讨论失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);

  function toggleMention(m: Member) {
    const on = mentionIds.includes(m.id);
    setMentionIds((prev) => (on ? prev.filter((id) => id !== m.id) : [...prev, m.id]));
    if (!on) {
      setContent((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}@${m.name} `);
    }
  }

  function onFiles(list: FileList | null) {
    if (!list) return;
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) {
        setError(`「${f.name}」超过 3MB，未上传`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          { name: f.name, type: f.type, size: f.size, dataUrl: String(reader.result) },
        ]);
      };
      reader.readAsDataURL(f);
    }
  }

  async function submit() {
    const text = content.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          parentId: replyTo?.id,
          mentions: mentionIds,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "发送失败");
        return;
      }
      setItems((prev) => [...prev, { kind: "comment", comment: data.comment }]);
      setContent("");
      setMentionIds([]);
      setAttachments([]);
      setReplyTo(null);
      router.refresh(); // 刷新看板卡片评论气泡
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  async function handleMarkImportant(commentId: string, important: boolean, type?: ImportanceType) {
    setError(null);
    const res = await fetch(`/api/comments/${commentId}/important`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ important, type }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "标记失败");
      return false;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "comment" && it.comment.id === commentId
          ? {
              ...it,
              comment: {
                ...it.comment,
                isImportant: data.comment.isImportant,
                importanceType: data.comment.importanceType,
              },
            }
          : it,
      ),
    );
    router.refresh();
    return true;
  }

  async function handleEdit(commentId: string, content: string) {
    setError(null);
    const res = await fetch(`/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "编辑失败");
      return false;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "comment" && it.comment.id === commentId
          ? {
              ...it,
              comment: {
                ...it.comment,
                content: data.comment.content,
                editedAt: data.comment.editedAt,
                editCount: data.comment.editCount,
              },
            }
          : it,
      ),
    );
    router.refresh();
    return true;
  }

  async function handleDelete(comment: CommentDto) {
    setError(null);
    const res = await fetch(`/api/comments/${comment.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "删除失败");
      return false;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "comment" && it.comment.id === comment.id
          ? { ...it, comment: { ...it.comment, deletedAt: data.comment.deletedAt ?? new Date().toISOString() } }
          : it,
      ),
    );
    router.refresh();
    return true;
  }

  // 「只看重要」：仅重要且未删除的评论（已删除不参与重要筛选）
  const displayItems = onlyImportant
    ? items.filter(
        (it) => it.kind === "comment" && it.comment.isImportant && !it.comment.deletedAt,
      )
    : items;

  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium text-ink-soft">讨论 · 时间线</h4>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={onlyImportant}
            onChange={(e) => setOnlyImportant(e.target.checked)}
          />
          只看重要
        </label>
      </div>

      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {loading && <p className="text-xs text-ink-faint">加载中…</p>}
        {!loading && displayItems.length === 0 && (
          <p className="text-xs text-ink-faint">
            {onlyImportant ? "暂无重要评论。" : "暂无讨论，发一条吧。"}
          </p>
        )}
        {displayItems.map((it) =>
          it.kind === "activity" ? (
            <ActivityRow key={`a-${it.activity.id}`} activity={it.activity} />
          ) : (
            <CommentRow
              key={`c-${it.comment.id}`}
              comment={it.comment}
              nameById={nameById}
              viewerId={viewerId}
              viewerRole={viewerRole}
              canMark={canMark}
              onReply={() => setReplyTo(it.comment)}
              onMarkImportant={handleMarkImportant}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mt-1 text-xs text-high">{error}</p>}

      {replyTo && (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
          回复 {replyTo.authorName ?? "成员"}：
          <button type="button" onClick={() => setReplyTo(null)} className="text-ink-faint underline">
            取消
          </button>
        </p>
      )}

      <div className="mt-2 space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="ac-field text-sm"
          placeholder="写评论… 支持 @成员"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <li key={i} className="flex items-center gap-1 rounded bg-sunken px-2 py-1 text-xs text-ink-soft">
                <span className="max-w-[10rem] truncate">{a.name}</span>
                <span className="text-ink-faint">({fmtSize(a.size)})</span>
                <button
                  type="button"
                  aria-label="移除附件"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-high"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMentionOpen((o) => !o)}
              className="ac-btn-ghost"
            >
              @提及
            </button>
            {mentionOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-pop">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-sunken"
                  >
                    <input
                      type="checkbox"
                      checked={mentionIds.includes(m.id)}
                      onChange={() => toggleMention(m)}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="ac-btn-ghost cursor-pointer">
            上传附件
            <input
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.md,.txt,.doc,.docx,.xls,.xlsx"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>

          <button type="button" onClick={submit} disabled={pending || !content.trim()} className="ac-btn ml-auto">
            {pending ? "发送中…" : replyTo ? "回复" : "评论"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ activity }: { activity: ActivityDto }) {
  let text = "";
  if (activity.type === "status_changed") {
    const from = STATUS_LABEL[String(activity.payload.from)] ?? activity.payload.from;
    const to = STATUS_LABEL[String(activity.payload.to)] ?? activity.payload.to;
    text = `将状态从「${from}」改为「${to}」`;
  } else if (activity.type === "dependency_added") {
    text = `添加了前置任务「${activity.payload.predecessorTitle ?? ""}」`;
  } else if (activity.type === "dependency_removed") {
    text = `移除了前置任务「${activity.payload.predecessorTitle ?? ""}」`;
  } else if (activity.type === "comment_deleted") {
    text = "删除了一条重要评论";
  }
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <p className="text-ink-soft">
        <span className="font-medium text-ink">{activity.actorName ?? "成员"}</span> {text}
        <span className="ml-2 text-ink-faint">{fmtTime(activity.createdAt)}</span>
      </p>
    </div>
  );
}

function CommentRow({
  comment,
  nameById,
  viewerId,
  viewerRole,
  canMark,
  onReply,
  onMarkImportant,
  onEdit,
  onDelete,
}: {
  comment: CommentDto;
  nameById: Map<string, string>;
  viewerId: string;
  viewerRole: ViewerRole;
  canMark: boolean;
  onReply: () => void;
  onMarkImportant: (id: string, important: boolean, type?: ImportanceType) => Promise<boolean>;
  onEdit: (id: string, content: string) => Promise<boolean>;
  onDelete: (comment: CommentDto) => Promise<boolean>;
}) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const deleted = Boolean(comment.deletedAt);
  const canEditThis = !deleted && comment.userId === viewerId;
  const canDeleteThis = !deleted && (comment.userId === viewerId || viewerRole === "admin" || viewerRole === "teacher");
  const canViewHistory = comment.userId === viewerId || viewerRole === "admin" || viewerRole === "teacher";

  function startEdit() {
    setDraft(comment.content);
    setEditing(true);
  }

  async function saveEdit() {
    const text = draft.trim();
    if (!text) return;
    const ok = await onEdit(comment.id, text);
    if (ok) setEditing(false);
  }

  function confirmDelete() {
    if (!confirm("确认删除该评论？")) return;
    if (comment.isImportant) {
      if (!confirm("该评论已标记重要，删除后不可恢复，确认继续？")) return;
    }
    void onDelete(comment);
  }

  return (
    <div
      className={`rounded-lg p-2.5 text-sm ${comment.parentId ? "ml-6" : ""} ${
        comment.isImportant ? "bg-surface ring-1 ring-accent" : "bg-sunken"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-white">
          {(comment.authorName ?? "?").slice(0, 1)}
        </span>
        <span className="font-medium text-ink">{comment.authorName ?? "成员"}</span>
        {comment.parentId && <span className="text-xs text-ink-faint">回复</span>}
        <span className="text-xs text-ink-faint">{fmtTime(comment.createdAt)}</span>
        {comment.isImportant && (
          <>
            <span className="text-amber-500" title="重要评论" aria-label="重要评论">
              ★
            </span>
            <span className="ac-badge bg-accent text-white">重要</span>
            {comment.importanceType && (
              <span className={`ac-badge ${IMPORTANCE_BADGE[comment.importanceType] ?? IMPORTANCE_BADGE.reference}`}>
                {IMPORTANCE_LABEL[comment.importanceType]}
              </span>
            )}
          </>
        )}
        {!deleted && comment.editedAt && (
          canViewHistory ? (
            <button
              type="button"
              title={`编辑于 ${fmtTime(comment.editedAt)}`}
              onClick={() => setShowHistory((s) => !s)}
              className="text-xs text-ink-faint underline decoration-dotted hover:text-primary"
            >
              已编辑
            </button>
          ) : (
            <span title={`编辑于 ${fmtTime(comment.editedAt)}`} className="text-xs text-ink-faint">
              已编辑
            </span>
          )
        )}
      </div>

      {deleted ? (
        <p className="mt-1 text-sm text-ink-faint">该评论已删除</p>
      ) : editing ? (
        <div className="mt-1 space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="ac-field text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveEdit} disabled={!draft.trim()} className="ac-btn text-xs">
              保存
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-faint underline">
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-ink">{comment.content}</p>
      )}

      {!deleted && comment.mentions.length > 0 && (
        <p className="mt-1 text-xs text-primary">
          提及：
          {comment.mentions.map((id, i) => (
            <span key={id}>
              {i > 0 && "、"}@{nameById.get(id) ?? "成员"}
            </span>
          ))}
        </p>
      )}

      {!deleted && comment.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {comment.attachments.map((a, i) =>
            a.type.startsWith("image/") ? (
              <a key={i} href={a.dataUrl} download={a.name} target="_blank" rel="noreferrer" title={a.name}>
                {/* eslint-disable-next-line @next/next/no-img-element -- dataURL 附件，非静态资源，Next Image 无法优化 */}
                <img src={a.dataUrl} alt={a.name} className="h-16 w-16 rounded object-cover ring-1 ring-line" />
              </a>
            ) : (
              <a
                key={i}
                href={a.dataUrl}
                download={a.name}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded bg-surface px-2 py-1 text-xs text-primary ring-1 ring-line hover:underline"
              >
                📎 {a.name} ({fmtSize(a.size)})
              </a>
            ),
          )}
        </div>
      )}

      {!deleted && showHistory && canViewHistory && (
        <EditHistory commentId={comment.id} />
      )}

      {!deleted && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onReply} className="text-xs text-ink-faint hover:text-primary">
            回复
          </button>

          {canMark &&
            (comment.isImportant ? (
              <button
                type="button"
                onClick={() => void onMarkImportant(comment.id, false)}
                className="text-xs text-ink-faint hover:text-high"
              >
                取消重要
              </button>
            ) : picking ? (
              <span className="flex items-center gap-1 text-xs text-ink-soft">
                类型：
                {(["decision", "issue", "delivery", "reference"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      void onMarkImportant(comment.id, true, t);
                      setPicking(false);
                    }}
                    className={`rounded px-1.5 py-0.5 ${IMPORTANCE_BADGE[t]}`}
                  >
                    {IMPORTANCE_LABEL[t]}
                  </button>
                ))}
                <button type="button" onClick={() => setPicking(false)} className="text-ink-faint underline">
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="text-xs text-ink-faint hover:text-amber-500"
              >
                ☆ 标记重要
              </button>
            ))}

          {canEditThis && (
            <button type="button" onClick={startEdit} className="text-xs text-ink-faint hover:text-primary">
              编辑
            </button>
          )}

          {canDeleteThis && (
            <button type="button" onClick={confirmDelete} className="text-xs text-ink-faint hover:text-high">
              删除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditHistory({ commentId }: { commentId: string }) {
  const [edits, setEdits] = useState<EditDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/comments/${commentId}/history`);
        const d = await r.json();
        if (!cancelled) setEdits(d.edits ?? []);
      } catch {
        if (!cancelled) setEdits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentId]);

  if (edits === null) return <p className="mt-1 text-xs text-ink-faint">加载编辑历史…</p>;
  if (edits.length === 0) return <p className="mt-1 text-xs text-ink-faint">暂无编辑历史</p>;

  return (
    <ul className="mt-1.5 space-y-1.5 rounded bg-sunken p-2 text-xs text-ink-soft">
      {edits.map((e) => (
        <li key={e.id}>
          <p className="text-ink-faint">
            {e.editorName ?? "成员"} 于 {fmtTime(e.createdAt)} 编辑：
          </p>
          <p className="text-ink line-through decoration-high/50">{e.oldContent}</p>
          <p className="text-ink">→ {e.newContent}</p>
        </li>
      ))}
    </ul>
  );
}
