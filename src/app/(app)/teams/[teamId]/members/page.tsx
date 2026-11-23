import { z } from "zod";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teamMembers, teams, users } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { leaveTeamAction, removeMemberAction, updateRoleAction } from "./actions";
import { ConfirmForm } from "./confirm-form";

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { teamId } = await params;
  const { error } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  // teamId 来自 URL，非法 uuid 会导致后续查询报 DB 错误——提前拦截，语义上等同于「不存在」
  if (!z.uuid().safeParse(teamId).success) notFound();

  // 访问者必须是团队成员（非成员 404，不泄露团队存在性）
  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-2xl space-y-6 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink">{team.name} · 成员</h1>

      {error && (
        <p className="rounded-lg bg-high-soft px-3 py-2 text-sm text-high">{error}</p>
      )}

      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.userId} className="ac-card flex flex-wrap items-center justify-between gap-2 p-4">
            <span className="text-ink">
              {m.name} <span className="text-xs text-ink-soft">{m.email}</span>
            </span>
            {isAdmin && m.userId !== session.user.id ? (
              <div className="flex items-center gap-2">
                <form action={updateRoleAction} className="flex items-center gap-2">
                  <input type="hidden" name="teamId" value={teamId} />
                  <input type="hidden" name="userId" value={m.userId} />
                  {/* key=role：角色变更后强制重挂载，使 defaultValue 重新采纳（非受控 select 不更新已挂载节点） */}
                  <select key={m.role} name="role" defaultValue={m.role} className="ac-field w-auto py-1 text-sm">
                    <option value="admin">admin（管理员）</option>
                    <option value="teacher">teacher（教师）</option>
                    <option value="leader">leader（小组长）</option>
                    <option value="student">student（学生）</option>
                  </select>
                  <button className="ac-btn px-2 py-1 text-xs">保存</button>
                </form>
                <ConfirmForm
                  action={removeMemberAction}
                  message={`确定把 ${m.name} 移出团队？其任务指派会被清除，任务本身保留。`}
                >
                  <input type="hidden" name="teamId" value={teamId} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="ac-btn-ghost px-2 py-1 text-xs text-high">移除</button>
                </ConfirmForm>
              </div>
            ) : (
              <span className="text-sm text-ink-soft">{m.role}</span>
            )}
          </li>
        ))}
      </ul>

      <ConfirmForm
        action={leaveTeamAction}
        message="确定退出该团队？退出后将看不到团队内的项目。"
        className="border-t border-line pt-4"
      >
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="userId" value={session.user.id} />
        <button className="text-sm text-ink-faint underline hover:text-high">退出团队</button>
      </ConfirmForm>
    </main>
  );
}
