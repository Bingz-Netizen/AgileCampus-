import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { deleteComment, editComment } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ commentId: string }> };

const editSchema = z.object({
  content: z.string().trim().min(1, "评论内容不可为空"),
});

function parseCommentId(raw: string) {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

function mapError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(tag, e);
  return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
}

// 编辑评论：仅评论作者可编辑自己的评论（旧文进编辑历史）
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { commentId } = await ctx.params;
  const cid = parseCommentId(commentId);
  if (!cid) return NextResponse.json({ error: "commentId 无效" }, { status: 400 });

  const parsed = editSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const comment = await editComment(session.user.id, cid, parsed.data.content);
    return NextResponse.json({ comment });
  } catch (e) {
    return mapError(e, "[PATCH /api/comments/:commentId]");
  }
}

// 删除评论：作者或 admin/teacher；软删除（时间线显示「该评论已删除」）
export async function DELETE(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { commentId } = await ctx.params;
  const cid = parseCommentId(commentId);
  if (!cid) return NextResponse.json({ error: "commentId 无效" }, { status: 400 });

  try {
    const comment = await deleteComment(session.user.id, cid);
    return NextResponse.json({ comment });
  } catch (e) {
    return mapError(e, "[DELETE /api/comments/:commentId]");
  }
}
