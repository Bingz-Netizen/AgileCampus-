import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { teamMembers, teams, users, type TeamRole } from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";

export async function createTeam(userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ name, inviteCode: nanoid(10) })
      .returning();
    await tx.insert(teamMembers).values({
      teamId: team.id,
      userId,
      role: "admin",
    });
    return team;
  });
}

export async function joinTeam(userId: string, inviteCode: string) {
  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
  if (!team) throw new AppError("邀请码无效");

  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  try {
    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: team.id, userId, role: "student" })
      .returning();
    return member;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先加入，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("已在该团队中");
    throw e;
  }
}

export async function getTeamMembership(userId: string, teamId: string) {
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return member ?? null;
}

export async function requireTeamRole(
  userId: string,
  teamId: string,
  allowed: TeamRole[],
) {
  const member = await getTeamMembership(userId, teamId);
  if (!member || !allowed.includes(member.role)) throw new ForbiddenError();
  return member;
}

// 无权限前置：调用方须已校验访问权（如 getProjectForUser / requireTeamRole）后再调用
export async function listTeamMembers(teamId: string) {
  return db
    .select({ id: users.id, name: users.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
}

async function countAdmins(teamId: string) {
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
  return rows.length;
}

export async function updateMemberRole(
  actorId: string,
  teamId: string,
  targetUserId: string,
  role: TeamRole,
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
  if (!target) throw new AppError("该成员不在团队中");

  // 末位管理员不变量：不能把最后一名 admin 降级，否则团队无人可管理
  if (target.role === "admin" && role !== "admin" && (await countAdmins(teamId)) <= 1) {
    throw new AppError("团队至少保留一名管理员，不能降级最后一名管理员");
  }

  const [updated] = await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning();
  return updated;
}

/** 管理员移除成员；被移除者若是最后一名管理员则拒绝 */
export async function removeTeamMember(actorId: string, teamId: string, targetUserId: string) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
  if (!target) throw new AppError("该成员不在团队中");
  if (target.role === "admin" && (await countAdmins(teamId)) <= 1) {
    throw new AppError("不能移除最后一名管理员");
  }
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
}

/** 主动退出团队；最后一名管理员须先转让或先提升他人为管理员 */
export async function leaveTeam(actorId: string, teamId: string) {
  const member = await getTeamMembership(actorId, teamId);
  if (!member) throw new AppError("你不在该团队中");
  if (member.role === "admin" && (await countAdmins(teamId)) <= 1) {
    throw new AppError("你是团队唯一的管理员，请先把他人设为管理员再退出");
  }
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actorId)));
}
