import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { markCommentImportant } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ commentId: string }> };

const importantSchema = z.object({
  important: z.boolean(),
  type: z.enum(["decision", "issue", "delivery", "reference"]).optional(),
});

// 标记 / 取消标记「重要评论」：仅 admin/teacher（类型 decision/issue/delivery/reference）
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { commentId } = await ctx.params;
  if (!z.uuid().safeParse(commentId).success) {
    return NextResponse.json({ error: "commentId 无效" }, { status: 400 });
  }

  const parsed = importantSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const comment = await markCommentImportant(session.user.id, commentId, parsed.data);
    return NextResponse.json({ comment });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[PATCH /api/comments/:commentId/important]", e);
    return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
  }
}
