import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listRetros } from "@/lib/retro";
import { listSprintOptions } from "@/lib/sprint";
import { RetroForm } from "./retro-form";
import { RetroCard, type RetroItem } from "./retro-card";

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

  const items: RetroItem[] = retros.map((r) => ({
    id: r.id,
    title: r.title,
    wentWell: r.wentWell,
    wentBad: r.wentBad,
    improvements: r.improvements,
    pitfalls: r.pitfalls,
    sprintId: r.sprintId,
    sprintName: r.sprintName,
    authorName: r.authorName,
    createdAtLabel: r.createdAt.toLocaleDateString("sv-SE"),
    canManage:
      r.createdById === session.user.id ||
      access.role === "admin" ||
      access.role === "teacher",
  }));

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
        {items.length === 0 && <p className="text-sm text-ink-faint">还没有复盘记录。</p>}
        {items.map((r) => (
          <RetroCard
            key={r.id}
            projectId={projectId}
            retro={r}
            sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
          />
        ))}
      </section>
    </main>
  );
}
