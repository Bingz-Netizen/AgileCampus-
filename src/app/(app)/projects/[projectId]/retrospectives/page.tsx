import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listRetros } from "@/lib/retro";
import { listSprintOptions } from "@/lib/sprint";
import { RetroForm } from "./retro-form";

export default async function RetrospectivesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const [retros, sprints] = await Promise.all([
    listRetros(session.user.id, projectId),
    listSprintOptions(session.user.id, projectId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <Link href={`/projects/${projectId}`} className="ac-btn-ghost">
          ← 返回项目：{access.project.name}
        </Link>
        <h1 className="font-display text-2xl font-semibold text-ink">迭代复盘</h1>
        <p className="text-sm text-ink-soft">
          最后一周的复盘会记录：做得好的、待改进、改进措施、踩坑点。提交材料时可以整页复制。
        </p>
      </header>

      <RetroForm
        projectId={projectId}
        sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
      />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">历史复盘</h2>
        {retros.length === 0 && <p className="text-sm text-ink-faint">还没有复盘记录。</p>}
        {retros.map((r) => (
          <article key={r.id} className="ac-card space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-ink">{r.title}</h3>
              <span className="text-xs text-ink-faint">
                {r.sprintName ? `${r.sprintName} · ` : ""}
                {r.authorName ?? "已注销用户"} · {r.createdAt.toLocaleDateString("sv-SE")}
              </span>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["做得好的", r.wentWell],
                ["待改进的", r.wentBad],
                ["改进措施", r.improvements],
                ["踩坑点", r.pitfalls],
              ].map(([label, value]) =>
                value ? (
                  <div key={String(label)}>
                    <dt className="text-xs text-ink-faint">{label}</dt>
                    <dd className="whitespace-pre-wrap text-ink">{value}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </article>
        ))}
      </section>
    </main>
  );
}
