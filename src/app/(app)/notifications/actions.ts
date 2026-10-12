"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/comment";

// 点开某条通知：标记已读并跳到对应任务讨论
export async function markReadAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");

  if (z.uuid().safeParse(id).success) {
    await markNotificationRead(session.user.id, id);
  }
  revalidatePath("/notifications");
  redirect(`/projects/${projectId}?task=${taskId}&view=kanban`);
}

export async function markAllReadAction() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  await markAllNotificationsRead(session.user.id);
  revalidatePath("/notifications");
}
