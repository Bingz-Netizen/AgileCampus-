import { notFound, redirect } from "next/navigation";
import { z } from "zod";

// 任务详情已改为项目页内嵌视图（/projects/[projectId]?task=[taskId]）。
// 此路由保留作为旧深链（通知/档案/飞书卡片等历史链接）的入口，直接重定向到内嵌视图；
// 鉴权与任务归属校验由目标项目页统一承担。
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
}) {
  const { projectId, taskId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  if (!z.uuid().safeParse(taskId).success) notFound();
  redirect(`/projects/${projectId}?task=${taskId}`);
}
