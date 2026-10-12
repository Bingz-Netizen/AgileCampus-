import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyMentionNotifications } from "@/lib/comment";
import { markAllReadAction, markReadAction } from "./actions";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const items = await listMyMentionNotifications(session.user.id);
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <main className="mx-auto max-w-3xl space-y-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">通知</h1>
          <p className="mt-1 text-sm text-ink-soft">被 @ 提及的讨论（{unread} 条未读）</p>
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="ac-btn-ghost">全部已读</button>
          </form>
        )}
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">暂无通知。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className={`ac-card p-3 text-sm ${!it.readAt ? "ring-1 ring-accent" : ""}`}
            >
              <form action={markReadAction}>
                <input type="hidden" name="id" value={it.id} />
                <input type="hidden" name="projectId" value={it.projectId ?? ""} />
                <input type="hidden" name="taskId" value={it.taskId ?? ""} />
                <button type="submit" className="block w-full text-left">
                  <p className="text-xs text-ink-faint">
                    {it.projectName} · {it.taskTitle}
                  </p>
                  <p className="mt-1 text-ink">
                    <span className="font-medium">{it.commenterName ?? "成员"}</span> 在评论中提到了你：
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-ink-soft">{it.commentContent}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {new Date(it.createdAt).toLocaleString("zh-CN")}
                  </p>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
