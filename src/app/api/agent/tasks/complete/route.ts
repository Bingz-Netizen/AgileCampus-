import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { getTaskDetail, updateTask } from "@/lib/task";
import { submitReview } from "@/lib/task-review";

const schema = z.object({
  taskId: z.uuid(),
  completionNote: z.string().min(1),
});

// CC 写入：填写完成情况——记录完成说明并提交评审（doing → reviewing）。
// 完成（done）须经教师评审通过，故此处不再直接标 done。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await getTaskDetail(userId, parsed.data.taskId);
    // 待办任务先开工再提交评审；否则仅补完成说明（保持当前状态）
    const patch =
      task.status === "todo"
        ? { status: "doing" as const, completionNote: parsed.data.completionNote }
        : { completionNote: parsed.data.completionNote };
    await updateTask(userId, parsed.data.taskId, patch);
    await submitReview(userId, parsed.data.taskId);
    return NextResponse.json({ id: task.id, status: "reviewing" });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/tasks/complete]");
  }
}
