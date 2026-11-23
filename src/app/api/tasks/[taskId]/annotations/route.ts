import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { addAnnotation, listAnnotations } from "@/lib/annotation";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ taskId: string }> };

const createSchema = z.object({
  content: z.string().trim().min(1, "批注内容不可为空"),
  // 仅普通批注走此入口；评审意见/退回意见由评审动作自动写入
  kind: z.literal("comment").optional(),
  parentId: z.uuid().optional(),
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

// 列某任务的全部批注（含作者名、回复、评审/退回意见）
export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await ctx.params;
  const tid = parseTaskId(taskId);
  if (!tid) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  try {
    const annotations = await listAnnotations(session.user.id, tid);
    return NextResponse.json({ annotations });
  } catch (e) {
    return mapError(e, "[GET /api/tasks/:id/annotations]");
  }
}

// 发批注 / 回复（parentId）：师生均可
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
    const annotation = await addAnnotation(session.user.id, tid, parsed.data);
    return NextResponse.json({
      annotation: { ...annotation, authorName: session.user.name },
    });
  } catch (e) {
    return mapError(e, "[POST /api/tasks/:id/annotations]");
  }
}
