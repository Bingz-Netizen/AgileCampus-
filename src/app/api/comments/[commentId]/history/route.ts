import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listCommentHistory } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ commentId: string }> };

// 评论编辑历史：作者或 admin/teacher 可查看
export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { commentId } = await ctx.params;
  if (!z.uuid().safeParse(commentId).success) {
    return NextResponse.json({ error: "commentId 无效" }, { status: 400 });
  }

  try {
    const edits = await listCommentHistory(session.user.id, commentId);
    return NextResponse.json({ edits });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[GET /api/comments/:commentId/history]", e);
    return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
  }
}
