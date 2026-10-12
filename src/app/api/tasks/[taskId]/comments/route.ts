import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createComment, listTaskComments } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ taskId: string }> };

const attachmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().int().nonnegative(),
  dataUrl: z.string().min(1),
});

const createSchema = z.object({
  content: z.string().trim().min(1, "评论内容不可为空"),
  parentId: z.uuid().optional(),
  mentions: z.array(z.uuid()).optional(),
  attachments: z.array(attachmentSchema).optional(),
});

function parseTaskId(raw: string) {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

function mapError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(tag, e);
  return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
}

// 列某任务的全部评论（含作者名、回复、@提及、附件、归档标记）
export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await ctx.params;
  const tid = parseTaskId(taskId);
  if (!tid) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  try {
    const comments = await listTaskComments(session.user.id, tid);
    return NextResponse.json({ comments });
  } catch (e) {
    return mapError(e, "[GET /api/tasks/:id/comments]");
  }
}

// 发评论 / 回复（parentId）：内容 + @提及 + 附件（dataURL 内联）
export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await ctx.params;
  const tid = parseTaskId(taskId);
  if (!tid) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const comment = await createComment(session.user.id, tid, parsed.data);
    return NextResponse.json({
      comment: {
        ...comment,
        authorName: session.user.name,
      },
    });
  } catch (e) {
    return mapError(e, "[POST /api/tasks/:id/comments]");
  }
}
