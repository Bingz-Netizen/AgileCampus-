"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { leaveTeam, removeTeamMember, updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";

const schema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["admin", "teacher", "leader", "student"]),
});

export async function updateRoleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = schema.parse(Object.fromEntries(formData));
  try {
    await updateMemberRole(session.user.id, parsed.teamId, parsed.userId, parsed.role);
  } catch (e) {
    // 末位管理员等业务约束：带错误回跳，避免整页 500
    const msg = e instanceof AppError ? e.message : "操作失败";
    redirect(`/teams/${parsed.teamId}/members?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/teams/${parsed.teamId}/members`);
}

const targetSchema = z.object({ teamId: z.uuid(), userId: z.uuid() });

export async function removeMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = targetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  try {
    await removeTeamMember(session.user.id, parsed.data.teamId, parsed.data.userId);
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "操作失败";
    redirect(`/teams/${parsed.data.teamId}/members?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/teams/${parsed.data.teamId}/members`);
}

export async function leaveTeamAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = targetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  try {
    await leaveTeam(session.user.id, parsed.data.teamId);
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "操作失败";
    redirect(`/teams/${parsed.data.teamId}/members?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/teams");
  redirect("/teams");
}
