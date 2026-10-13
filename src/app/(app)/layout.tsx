import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/comment";
import { hasTeacherRoleAnywhere } from "@/lib/workbench";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const unread = await countUnreadNotifications(session.user.id);
  // 工作台入口仅教师/管理员可见（学生手输 URL 进入也只会看到本人口径，见 workbench/page.tsx）
  const isTeacher = await hasTeacherRoleAnywhere(session.user.id);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link href="/projects" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-primary font-display text-sm font-bold text-white shadow-sm"
            >
              A
            </span>
            <span className="font-display text-lg font-semibold text-ink">AgileCampus</span>
          </Link>
          <nav className="flex items-center gap-1">
            {isTeacher && (
              <Link
                href="/workbench"
                className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
              >
                工作台
              </Link>
            )}
            <Link
              href="/projects"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              所有项目
            </Link>
            <Link
              href="/teams"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              我的团队
            </Link>
            <Link
              href="/notifications"
              className="relative rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              通知
              {unread > 0 && (
                <span
                  aria-label={`${unread} 条未读通知`}
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-high ring-2 ring-surface"
                />
              )}
            </Link>
            <Link
              href="/settings/tokens"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              设置
            </Link>
          </nav>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="flex items-center gap-3"
        >
          <span className="hidden text-sm text-ink-soft sm:inline">{session.user.name}</span>
          <button className="ac-btn-ghost">退出</button>
        </form>
      </header>
      <div className="mx-auto max-w-5xl p-6">{children}</div>
    </div>
  );
}
