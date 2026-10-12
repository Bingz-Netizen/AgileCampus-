import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectArchives } from "@/lib/comment";

const KIND_LABEL: Record<string, string> = { decision: "决策", issue: "问题", delivery: "交付" };
const KIND_BADGE: Record<string, string> = {
  decision: "bg-primary-soft text-primary",
  issue: "bg-high-soft text-high",
  delivery: "bg-low-soft text-low",
};

// 项目档案：被标记「决策/问题/交付」的重要讨论，按标记分组展示，可跳回任务。
export default async function ProjectArchivePage({
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
  const archives = await listProjectArchives(session.user.id, projectId);

  const groups = (["decision", "issue", "delivery"] as const)
    .map((kind) => ({ kind, items: archives.filter((a) => a.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <header>
        <p className="text-xs text-ink-faint">
          <Link href={`/projects/${projectId}`} className="text-primary hover:underline">
            ← 返回项目
          </Link>
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">项目档案</h1>
        <p className="mt-1 text-sm text-ink-soft">
          任务讨论中被标记为「决策 / 问题 / 交付」的重要结论。
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">暂无归档。在任务讨论中标记「决策 / 问题 / 交付」即可归档至此。</p>
      ) : (
        groups.map((g) => (
          <section key={g.kind} className="space-y-2">
            <h2 className={`ac-badge ${KIND_BADGE[g.kind]}`}>{KIND_LABEL[g.kind]}</h2>
            <ul className="space-y-2">
              {g.items.map((a) => (
                <li key={a.id} className="ac-card p-3 text-sm">
                  <p className="flex items-center gap-2">
                    <Link
                      href={`/projects/${projectId}?task=${a.taskId}&view=kanban`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.taskTitle}
                    </Link>
                    <span className="text-xs text-ink-faint">
                      {a.authorName ?? "成员"} ·{" "}
                      {new Date(a.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{a.content}</p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
