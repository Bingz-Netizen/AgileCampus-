import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { FeishuCard } from "./feishu-card";

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ feishu?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [row] = await db
    .select({ feishuName: users.feishuName, feishuBoundAt: users.feishuBoundAt })
    .from(users)
    .where(eq(users.id, session.user.id));
  const { feishu } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">设置</h1>
        <p className="text-sm text-ink-soft">账号、新手引导与个人访问令牌设置。</p>
      </header>

      <FeishuCard
        boundName={row?.feishuName ?? null}
        boundAtLabel={fmt(row?.feishuBoundAt ?? null)}
        notice={feishu ?? null}
      />

      {/* 引导手册入口：查看三步流程简介 + 当前进度，可重新开始引导 */}
      <section className="ac-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">引导手册</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              三步上手：建项目 → 拆任务 → 用看板，可随时重新开始。
            </p>
          </div>
          <Link href="/settings/onboarding" className="ac-btn-ghost whitespace-nowrap">
            查看手册
          </Link>
        </div>
      </section>

      {/* 个人令牌入口：保持原「设置 → 令牌」可达 */}
      <section className="ac-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">个人访问令牌</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              供 Claude Code 等外部程序写入；明文仅生成时显示一次。
            </p>
          </div>
          <Link href="/settings/tokens" className="ac-btn-ghost whitespace-nowrap">
            管理令牌
          </Link>
        </div>
      </section>
    </main>
  );
}
