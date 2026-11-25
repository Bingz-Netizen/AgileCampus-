import { NextResponse } from "next/server";
import { APICallError } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  projectId: z.uuid(),
  userText: z.string().trim().min(1, "请输入内容"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await runAgentTurn({
      actorId: session.user.id,
      projectId: parsed.data.projectId,
      userText: parsed.data.userText,
    });
    return NextResponse.json({ text: result.text, toolTrace: result.toolTrace, drafts: result.drafts });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });

    // 模型服务返回的业务错误（模型名不存在、密钥错误、余额不足等）：
    // 直接把服务商的原话透给前端，否则用户只看到「对话失败，请重试」根本无从排查。
    if (APICallError.isInstance(e)) {
      console.error("[/api/chat] 模型服务返回错误:", e.statusCode, e.responseBody);
      const detail = providerMessage(e);
      return NextResponse.json(
        { error: detail ? `模型服务返回错误：${detail}` : "模型服务返回错误，请检查设置里的地址与模型名" },
        { status: 400 },
      );
    }

    // 其它未预期错误：服务端留痕，对客户端只呈通用消息，不暴露内部细节
    console.error("[/api/chat] runAgentTurn 失败:", e);
    return NextResponse.json({ error: "对话失败，请重试" }, { status: 500 });
  }
}

// 从服务商响应体里取出人类可读的 message，取不到就退回 SDK 的 message（截断防刷屏）
function providerMessage(error: APICallError): string | null {
  const body = error.responseBody;
  if (body) {
    try {
      const data = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      const msg =
        typeof data.error === "string"
          ? data.error
          : (data.error?.message ?? data.message ?? null);
      if (msg) return msg.slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  }
  return error.message ? error.message.slice(0, 300) : null;
}
