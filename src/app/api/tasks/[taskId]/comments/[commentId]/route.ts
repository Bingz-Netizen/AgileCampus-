import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { markCommentKind } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ taskId: string; commentId: string }> };

const kindSchema = z.object({
  kind: z.enum(["decision", "issue", "delivery"]).nullable(),
});

// 标记 / 取消标记「决策 / 问题 / 交付」，即归档进项目档案
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { commentId } = await ctx.params;
  if (!z.uuid().safeParse(commentId).success) {
    return NextResponse.json({ error: "commentId 无效" }, { status: 400 });
  }

  const parsed = kindSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const comment = await markCommentKind(session.user.id, commentId, parsed.data.kind);
    return NextResponse.json({ comment });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[PATCH /api/tasks/:id/comments/:commentId]", e);
    return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
  }
}
