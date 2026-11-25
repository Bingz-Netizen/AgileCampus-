import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { ForbiddenError, AppError } from "@/lib/errors";

// 每项目、每用户复用最近一条会话：AI 对话属于个人，队友之间互不可见。
export async function getOrCreateConversation(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.createdById, actorId)))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({ projectId, createdById: actorId })
    .returning();
  return created;
}

export type ToolTraceEntry = { toolName: string; input: unknown; output: unknown };

/** 清空当前用户在该项目的对话历史（级联删除消息），不影响队友的会话 */
export async function clearConversation(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  await db
    .delete(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.createdById, actorId)));
}
export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
  toolTrace: ToolTraceEntry[],
) {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userText },
    {
      conversationId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolTrace.length > 0 ? toolTrace : null,
    },
  ]);
}

export async function listConversationMessages(actorId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conv) throw new AppError("会话不存在");
  const access = await getProjectForUser(actorId, conv.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}
