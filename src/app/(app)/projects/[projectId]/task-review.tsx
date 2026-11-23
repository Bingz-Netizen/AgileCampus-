"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addAnnotationAction,
  approveReviewAction,
  rejectReviewAction,
  submitReviewAction,
  type ReviewState,
} from "./review-actions";

export type AnnotationItem = {
  id: string;
  parentId: string | null;
  kind: "comment" | "review" | "reject";
  content: string;
  createdAt: string;
  authorName: string | null;
};

const KIND_LABEL: Record<string, string> = {
  comment: "批注",
  review: "评审意见",
  reject: "退回原因",
};

export function TaskReview({
  projectId,
  taskId,
  status,
  canSubmit,
  canApprove,
  canReject,
  annotations,
}: {
  projectId: string;
  taskId: string;
  status: "todo" | "doing" | "done" | "review" | "rejected";
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  annotations: AnnotationItem[];
}) {
  const router = useRouter();
  const [submitState, submitForm, submitting] = useActionState<ReviewState, FormData>(
    submitReviewAction,
    null,
  );
  const [approveState, approveForm, approving] = useActionState<ReviewState, FormData>(
    approveReviewAction,
    null,
  );
  const [rejectState, rejectForm, rejecting] = useActionState<ReviewState, FormData>(
    rejectReviewAction,
    null,
  );
  const [noteState, noteForm, noting] = useActionState<ReviewState, FormData>(
    addAnnotationAction,
    null,
  );
  const [replyTo, setReplyTo] = useState<string | null>(null);

  // 动作成功后刷新服务端数据（批注列表、状态、时间线）
  const ok = (s: ReviewState) => Boolean(s && "ok" in s);
  useEffect(() => {
    if (ok(submitState) || ok(approveState) || ok(rejectState) || ok(noteState)) {
      router.refresh();
    }
  }, [submitState, approveState, rejectState, noteState, router]);

  const roots = annotations.filter((a) => !a.parentId);

  return (
    <section className="ac-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-ink">评审</h2>
        <span className="text-xs text-ink-faint">
          {status === "review"
            ? "待评审：等待教师终审"
            : status === "rejected"
              ? "已退回：修改后重新提交"
              : status === "done"
                ? "已完成（终审通过）"
                : "未提交评审"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canSubmit && (
          <form action={submitForm}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <button disabled={submitting} className="ac-btn px-3 py-2 text-sm">
              {submitting ? "提交中…" : status === "rejected" ? "修改后重新提交" : "提交评审"}
            </button>
          </form>
        )}
        {canApprove && status === "review" && (
          <form action={approveForm} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <input name="note" placeholder="评审意见（可选）" className="ac-field w-56 text-sm" />
            <button disabled={approving} className="ac-btn px-3 py-2 text-sm">
              {approving ? "处理中…" : "通过评审"}
            </button>
          </form>
        )}
        {canReject && status === "review" && (
          <form action={rejectForm} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <input name="reason" placeholder="退回原因（必填）" required className="ac-field w-56 text-sm" />
            <button disabled={rejecting} className="ac-btn-ghost px-3 py-2 text-sm">
              {rejecting ? "处理中…" : "退回修改"}
            </button>
          </form>
        )}
      </div>

      {!canApprove && canReject && status === "review" && (
        <p className="text-xs text-medium">
          小组长初审：只能「退回修改」，终审通过由教师/管理员操作。
        </p>
      )}

      {!canSubmit && !canApprove && !canReject && (
        <p className="text-xs text-ink-faint">
          你没有本任务的评审操作权限：提交评审由负责人操作，通过仅教师/管理员，退回教师/管理员/小组长。
        </p>
      )}

      {[submitState, approveState, rejectState].map((s, i) =>
        s && "error" in s ? (
          <p key={i} className="text-sm text-high">
            {s.error}
          </p>
        ) : null,
      )}

      {/* 批注列表：普通批注 / 评审意见 / 退回原因同列展示，按时间排序，回复缩进一层 */}
      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="text-sm font-medium text-ink">批注与评审意见</h3>
        {annotations.length === 0 && <p className="text-xs text-ink-faint">还没有批注。</p>}
        <ul className="space-y-2">
          {roots.map((a) => (
            <li key={a.id} className="space-y-1">
              <AnnotationRow a={a} onReply={() => setReplyTo(a.id)} />
              <ul className="ml-4 space-y-1">
                {annotations
                  .filter((r) => r.parentId === a.id)
                  .map((r) => (
                    <li key={r.id}>
                      <AnnotationRow a={r} />
                    </li>
                  ))}
              </ul>
              {replyTo === a.id && (
                <form action={noteForm} className="ml-4 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="parentId" value={a.id} />
                  <input name="content" placeholder="回复这条批注…" className="ac-field flex-1 text-sm" />
                  <button disabled={noting} className="ac-btn-ghost px-2 py-1 text-xs">
                    回复
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="text-xs text-ink-faint hover:text-primary"
                  >
                    取消
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        <form action={noteForm} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input name="content" placeholder="发表批注（全体成员可见）" className="ac-field flex-1 text-sm" />
          <button disabled={noting} className="ac-btn px-3 py-2 text-sm">
            {noting ? "发送中…" : "发表批注"}
          </button>
        </form>
        {noteState && "error" in noteState && <p className="text-sm text-high">{noteState.error}</p>}
      </div>
    </section>
  );
}

function AnnotationRow({ a, onReply }: { a: AnnotationItem; onReply?: () => void }) {
  const tone =
    a.kind === "review"
      ? "border-done/40 bg-done/5"
      : a.kind === "reject"
        ? "border-high/40 bg-high/5"
        : "border-line bg-sunken";
  return (
    <div className={`rounded-lg border p-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span className="font-medium text-ink-soft">{a.authorName ?? "已注销用户"}</span>
        {a.kind !== "comment" && (
          <span
            className={`ac-badge ${a.kind === "review" ? "bg-done-soft text-done" : "bg-high-soft text-high"}`}
          >
            {KIND_LABEL[a.kind]}
          </span>
        )}
        <span>{new Date(a.createdAt).toLocaleString("zh-CN")}</span>
        {onReply && (
          <button type="button" onClick={onReply} className="ml-auto hover:text-primary">
            回复
          </button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-ink">{a.content}</p>
    </div>
  );
}
