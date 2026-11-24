import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listMyProjects(session.user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 py-8" data-onboarding-anchor="enter-project">
      <h1 className="font-display text-2xl font-semibold text-ink">所有项目</h1>
      {projects.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          暂无项目——先在团队中创建。
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
            return (
              <li key={p.id} className="ac-card group p-4 transition-shadow hover:shadow-pop">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="min-w-0 truncate font-display text-base font-semibold text-ink group-hover:text-primary"
                  >
                    {p.name}
                  </Link>
                  {p.status === "archived" ? (
                    <span className="ac-badge bg-low-soft text-low">已归档</span>
                  ) : (
                    <span className="ac-badge bg-done/12 text-done">进行中</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">{p.teamName}</p>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
                    <span>任务进度</span>
                    <span className="tabular-nums">
                      {p.doneCount}/{p.taskTotal}
                      {p.taskTotal > 0 ? ` · ${pct}%` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-done transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
