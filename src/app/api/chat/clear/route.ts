import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { clearConversation } from "@/lib/agent/conversation";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({ projectId: z.uuid() });

// 清空「我」在该项目的 AI 对话历史；队友的会话不受影响。
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  try {
    await clearConversation(session.user.id, parsed.data.projectId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/chat/clear] 失败:", e);
    return NextResponse.json({ error: "清空失败，请重试" }, { status: 500 });
  }
}
