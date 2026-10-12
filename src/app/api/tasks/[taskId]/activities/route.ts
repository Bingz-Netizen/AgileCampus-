import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listTaskActivities } from "@/lib/comment";
import { AppError, ForbiddenError } from "@/lib/errors";

type Ctx = { params: Promise<{ taskId: string }> };

// 列某任务的活动流（状态变更 / 依赖增删），供时间线与评论合并展示
export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { taskId } = await ctx.params;
  const parsed = z.uuid().safeParse(taskId);
  if (!parsed.success) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  try {
    const activities = await listTaskActivities(session.user.id, parsed.data);
    return NextResponse.json({ activities });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[GET /api/tasks/:id/activities]", e);
    return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
  }
}
