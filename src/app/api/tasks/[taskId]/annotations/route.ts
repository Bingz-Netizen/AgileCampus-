import { auth } from "@/lib/auth";
import { addAnnotation, listAnnotations } from "@/lib/review";
import { AppError, ForbiddenError } from "@/lib/errors";

// 任务批注的 REST 接口（供站外调用/自动化脚本使用）：
// 未登录 401；非项目成员 403；参数错误 400。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "未登录" }, { status: 401 });

  try {
    const items = await listAnnotations(session.user.id, taskId);
    return Response.json({
      annotations: items.map((a) => ({
        id: a.id,
        parentId: a.parentId,
        kind: a.kind,
        content: a.content,
        authorName: a.authorName,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ error: "无权访问" }, { status: 403 });
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const session = await auth();
  if (!session?.user) return Response.json({ error: "未登录" }, { status: 401 });

  let body: { content?: unknown; parentId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  const parentId = typeof body.parentId === "string" ? body.parentId : undefined;
  if (!content.trim()) return Response.json({ error: "批注内容不能为空" }, { status: 400 });

  try {
    const created = await addAnnotation(session.user.id, taskId, { content, parentId });
    return Response.json({ id: created.id }, { status: 201 });
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ error: "无权访问" }, { status: 403 });
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
