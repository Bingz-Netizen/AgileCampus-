import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOnboardingProgress, updateOnboardingProgress } from "@/lib/onboarding";
import { AppError, ForbiddenError } from "@/lib/errors";

// 新手引导进度：读（GET）/ 写（PATCH，只改自己的进度，userId 取 session）。
// 权限：无跨用户读写路径；路由层从 session 提取 userId，lib 层不暴露他人 userId 入口。

const patchSchema = z.object({
  roleType: z.enum(["leader", "member"]).optional(),
  currentStep: z.number().int().min(0).max(3).optional(),
  status: z.enum(["not_started", "in_progress", "completed", "skipped"]).optional(),
});

function mapError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(tag, e);
  return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    const progress = await getOnboardingProgress(session.user.id);
    return NextResponse.json({ progress });
  } catch (e) {
    return mapError(e, "[GET /api/onboarding/progress]");
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const progress = await updateOnboardingProgress(session.user.id, parsed.data);
    return NextResponse.json({ progress });
  } catch (e) {
    return mapError(e, "[PATCH /api/onboarding/progress]");
  }
}
