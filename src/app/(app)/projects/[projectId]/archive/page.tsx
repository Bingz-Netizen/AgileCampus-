import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectArchives } from "@/lib/comment";

const TYPE_LABEL: Record<string, string> = {
  decision: "决策",
  issue: "问题",
  delivery: "交付",
  reference: "参考",
};
const TYPE_BADGE: Record<string, string> = {
  decision: "bg-primary-soft text-primary",
  issue: "bg-high-soft text-high",
  delivery: "bg-low-soft text-low",
  reference: "bg-medium-soft text-medium",
};

// 项目档案：重要评论中「决策 / 交付」自动归档（旧 kind 标记的决策/问题/交付保留兼容），
// 按类型分组展示，可跳回任务；软删除的评论仍保留删除记录。
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

  const groups = (["decision", "issue", "delivery", "reference"] as const)
    .map((type) => ({
      type,
      items: archives.filter((a) => (a.importanceType ?? a.kind) === type),
    }))
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
          任务讨论中标记为「决策 / 交付」的重要结论（含旧「决策 / 问题 / 交付」归档）。
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">
          暂无归档。在任务讨论中标记重要评论为「决策 / 交付」即可归档至此。
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.type} className="space-y-2">
            <h2 className={`ac-badge ${TYPE_BADGE[g.type]}`}>{TYPE_LABEL[g.type]}</h2>
            <ul className="space-y-2">
              {g.items.map((a) => (
                <li key={a.id} className="ac-card p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/projects/${projectId}?task=${a.taskId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.taskTitle}
                    </Link>
                    <span className="text-xs text-ink-faint">
                      {a.authorName ?? "成员"} ·{" "}
                      {new Date(a.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                    {a.deletedAt && (
                      <span className="ac-badge bg-high-soft text-high">已删除</span>
                    )}
                  </p>
                  <p className={`mt-1 whitespace-pre-wrap ${a.deletedAt ? "text-ink-faint" : "text-ink"}`}>
                    {a.deletedAt ? "该评论已删除" : a.content}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
