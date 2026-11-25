import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { restartOnboarding } from "@/lib/onboarding";
import { AppError, ForbiddenError } from "@/lib/errors";

// 重新开始引导：重置本用户进度（只重置进度，不删业务数据），从指定步骤起。userId 取 session。

const restartSchema = z.object({
  roleType: z.enum(["leader", "member"]),
  startStep: z.number().int().min(0).max(3),
});

function mapError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(tag, e);
  return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = restartSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const progress = await restartOnboarding(session.user.id, parsed.data);
    return NextResponse.json({ progress });
  } catch (e) {
    return mapError(e, "[POST /api/onboarding/restart]");
  }
}
