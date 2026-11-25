"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveReviewAction,
  rejectReviewAction,
  resubmitReviewAction,
  submitReviewAction,
  type FormState,
} from "./review-actions";

type Option = { id: string; name: string };

type AnnotationDto = {
  id: string;
  parentId: string | null;
  content: string;
  kind: "comment" | "review" | "rejection";
  authorId: string;
  authorName: string;
  createdAt: string;
};

const KIND_BADGE: Record<AnnotationDto["kind"], { label: string; cls: string }> = {
  comment: { label: "批注", cls: "bg-sunken text-ink-soft" },
  review: { label: "评审意见", cls: "bg-done/10 text-done" },
  rejection: { label: "退回意见", cls: "bg-high-soft text-high" },
};

const STATUS_HINT: Record<string, string> = {
  doing: "进行中——完成后可提交评审",
  reviewing: "待评审——等待教师审阅",
  rejected: "已退回——修改后可重新提交",
  done: "已完成",
  todo: "待办——开始任务后可提交评审",
};

// 批注评审面板（第二阶段）：
// - 批注列表：项目成员（师生）都可发表与回复，评审意见/退回意见由评审动作自动写入
// - 评审区：学生（负责人）doing → 提交评审 / rejected → 重新提交；
//   教师（admin/teacher）reviewing → 通过 / 退回
export function TaskReviewPanel({
  projectId,
  taskId,
  status,
  viewerId,
  viewerRole,
  assigneeIds,
}: {
  projectId: string;
  taskId: string;
  status: string;
  viewerId: string;
  viewerRole: "admin" | "teacher" | "leader" | "student";
  assigneeIds: string[];
}) {
  const router = useRouter();
  // 两级评审权限：小组长（leader）可退回（初审），终审通过仅教师/管理员
  const canReject = viewerRole === "admin" || viewerRole === "teacher" || viewerRole === "leader";
  const canApprove = viewerRole === "admin" || viewerRole === "teacher";
  const isAssignee = assigneeIds.includes(viewerId);

  return (
    <div className="space-y-3">
      <ReviewActions
        projectId={projectId}
        taskId={taskId}
        status={status}
        canReject={canReject}
        canApprove={canApprove}
        isAssignee={isAssignee}
      />
      <AnnotationList projectId={projectId} taskId={taskId} viewerId={viewerId} onPosted={() => router.refresh()} />
    </div>
  );
}

function ReviewActions({
  projectId,
  taskId,
  status,
  canReject,
  canApprove,
  isAssignee,
}: {
  projectId: string;
  taskId: string;
  status: string;
  canReject: boolean;
  canApprove: boolean;
  isAssignee: boolean;
}) {
  const router = useRouter();
  const [submitState, submitAction, submitting] = useActionState<FormState, FormData>(submitReviewAction, null);
  const [resubmitState, resubmitAction, resubmitting] = useActionState<FormState, FormData>(resubmitReviewAction, null);
  const [approveState, approveAction, approving] = useActionState<FormState, FormData>(approveReviewAction, null);
  const [rejectState, rejectAction, rejecting] = useActionState<FormState, FormData>(rejectReviewAction, null);

  // 任一动作成功（返回 null）即刷新，让状态徽章与按钮随最新状态变化
  const submitSubmitted = useRef(false);
  useEffect(() => {
    if (submitting) submitSubmitted.current = true;
  }, [submitting]);
  useEffect(() => {
    if (submitSubmitted.current && !submitting && submitState === null) {
      submitSubmitted.current = false;
      router.refresh();
    }
  }, [submitting, submitState, router]);

  const resubmitSubmitted = useRef(false);
  useEffect(() => {
    if (resubmitting) resubmitSubmitted.current = true;
  }, [resubmitting]);
  useEffect(() => {
    if (resubmitSubmitted.current && !resubmitting && resubmitState === null) {
      resubmitSubmitted.current = false;
      router.refresh();
    }
  }, [resubmitting, resubmitState, router]);

  const approveSubmitted = useRef(false);
  useEffect(() => {
    if (approving) approveSubmitted.current = true;
  }, [approving]);
  useEffect(() => {
    if (approveSubmitted.current && !approving && approveState === null) {
      approveSubmitted.current = false;
      router.refresh();
    }
  }, [approving, approveState, router]);

  const rejectSubmitted = useRef(false);
  useEffect(() => {
    if (rejecting) rejectSubmitted.current = true;
  }, [rejecting]);
  useEffect(() => {
    if (rejectSubmitted.current && !rejecting && rejectState === null) {
      rejectSubmitted.current = false;
      router.refresh();
    }
  }, [rejecting, rejectState, router]);

  const error =
    (submitState && "error" in submitState && submitState.error) ||
    (resubmitState && "error" in resubmitState && resubmitState.error) ||
    (approveState && "error" in approveState && approveState.error) ||
    (rejectState && "error" in rejectState && rejectState.error) ||
    null;

  // 学生（负责人）：doing 提交评审 / rejected 重提
  const canSubmit = isAssignee && !canReject;
  // 初审者（教师/管理员/小组长）：reviewing 时显示评审面板
  const showPanel = canReject && status === "reviewing";

  if (!canSubmit && !showPanel && status !== "reviewing") {
    return <p className="text-xs text-ink-faint">{STATUS_HINT[status] ?? status}</p>;
  }

  return (
    <section className="space-y-2 border-t border-line pt-3">
      <h4 className="text-xs font-medium text-ink-soft">评审</h4>
      {canSubmit && status === "doing" && (
        <form action={submitAction} className="flex items-center justify-end gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <button disabled={submitting} className="ac-btn">
            {submitting ? "提交中…" : "提交评审"}
          </button>
        </form>
      )}
      {canSubmit && status === "rejected" && (
        <form action={resubmitAction} className="flex items-center justify-end gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <button disabled={resubmitting} className="ac-btn">
            {resubmitting ? "提交中…" : "修改后重新提交"}
          </button>
        </form>
      )}
      {canSubmit && status === "reviewing" && (
        <p className="text-xs text-ink-faint">{STATUS_HINT.reviewing}</p>
      )}
      {showPanel && (
        <div className="space-y-2">
          {canApprove && (
            <form action={approveAction} className="space-y-1.5">
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="projectId" value={projectId} />
              <textarea
                name="comment"
                rows={2}
                placeholder="评审意见（可选，通过时附言）"
                className="ac-field text-sm"
              />
              <div className="flex items-center justify-end gap-2">
                <button disabled={approving} className="ac-btn">
                  {approving ? "处理中…" : "通过评审"}
                </button>
              </div>
            </form>
          )}
          <form action={rejectAction} className="space-y-1.5">
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="projectId" value={projectId} />
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="退回原因（必填，学生修改后可重新提交）"
              className="ac-field text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                disabled={rejecting}
                className="text-xs text-high underline disabled:opacity-50"
              >
                {rejecting ? "处理中…" : "退回修改"}
              </button>
            </div>
          </form>
          {!canApprove && (
            <p className="text-xs text-ink-faint">
              小组长可退回不合格的提交；终审通过由教师操作
            </p>
          )}
        </div>
      )}
      {!canSubmit && !canReject && <p className="text-xs text-ink-faint">{STATUS_HINT[status] ?? status}</p>}
      {error && <p className="text-xs text-high">{error}</p>}
    </section>
  );
}

function AnnotationList({
  projectId,
  taskId,
  viewerId,
  onPosted,
}: {
  projectId: string;
  taskId: string;
  viewerId: string;
  onPosted?: () => void;
}) {
  const [items, setItems] = useState<AnnotationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<AnnotationDto | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/annotations`);
      const data = await res.json();
      if (res.ok) setItems(data.annotations ?? []);
      else setError(data.error ?? "加载失败");
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 首屏加载批注：异步 fetch 后再 setState，规则在此为误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const post = async () => {
    const text = content.trim();
    if (!text) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          kind: "comment",
          parentId: replyTo?.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setContent("");
        setReplyTo(null);
        await load();
        onPosted?.();
      } else {
        setError(data.error ?? "发布失败");
      }
    } catch {
      setError("发布失败");
    } finally {
      setPending(false);
    }
  };

  // 组树：顶层批注按时间正序，回复缩进展示
  const tops = items.filter((a) => a.parentId === null);
  const repliesOf = (id: string) => items.filter((a) => a.parentId === id);

  return (
    <section className="space-y-2 border-t border-line pt-3">
      <h4 className="text-xs font-medium text-ink-soft">批注（{items.length}）</h4>
      {loading ? (
        <p className="text-xs text-ink-faint">加载中…</p>
      ) : tops.length === 0 ? (
        <p className="text-xs text-ink-faint">暂无批注——师生都可在这里留言讨论</p>
      ) : (
        <ul className="space-y-2">
          {tops.map((a) => (
            <li key={a.id} className="space-y-1">
              <AnnotationRow
                a={a}
                viewerId={viewerId}
                onReply={() => setReplyTo(a)}
              />
              {repliesOf(a.id).length > 0 && (
                <ul className="ml-4 space-y-1 border-l border-line pl-3">
                  {repliesOf(a.id).map((r) => (
                    <li key={r.id}>
                      <AnnotationRow a={r} viewerId={viewerId} onReply={() => setReplyTo(a)} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        {replyTo && (
          <p className="text-xs text-ink-faint">
            回复 {replyTo.authorName}：
            <button
              className="ml-1 text-primary underline"
              onClick={() => setReplyTo(null)}
            >
              取消
            </button>
          </p>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="写批注…（师生均可发表与回复）"
          className="ac-field text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            disabled={pending || !content.trim()}
            onClick={post}
            className="ac-btn text-sm disabled:opacity-50"
          >
            {pending ? "发布中…" : replyTo ? "回复" : "发表批注"}
          </button>
        </div>
        {error && <p className="text-xs text-high">{error}</p>}
      </div>
    </section>
  );
}

function AnnotationRow({
  a,
  viewerId,
  onReply,
}: {
  a: AnnotationDto;
  viewerId: string;
  onReply: () => void;
}) {
  const kind = KIND_BADGE[a.kind];
  const time = a.createdAt.slice(0, 16).replace("T", " ");
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
        <span className="font-medium text-ink">{a.authorName}</span>
        <span className={`ac-badge ${kind.cls}`}>{kind.label}</span>
        <span className="text-ink-faint">{time}</span>
        {a.authorId !== viewerId && (
          <button onClick={onReply} className="text-primary underline">
            回复
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink">{a.content}</p>
    </div>
  );
}
