import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { FeishuCard } from "./feishu-card";
import { AiConfigCard } from "./ai-config";

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
    .select({
      feishuName: users.feishuName,
      feishuBoundAt: users.feishuBoundAt,
      aiApiKeyEnc: users.aiApiKeyEnc,
      aiBaseUrl: users.aiBaseUrl,
      aiModel: users.aiModel,
    })
    .from(users)
    .where(eq(users.id, session.user.id));
  const { feishu } = await searchParams;

  // 仅取尾号 4 位展示「已配置」状态，绝不回显明文
  const aiKey = row?.aiApiKeyEnc ? decryptSecret(row.aiApiKeyEnc) : null;
  const keyTail = aiKey ? aiKey.slice(-4) : null;

  return (
    <main className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">设置</h1>
        <p className="text-sm text-ink-soft">账号与通知设置。个人访问令牌见「设置 → 令牌」。</p>
      </header>

      <AiConfigCard
        configured={keyTail !== null}
        baseUrl={row?.aiBaseUrl ?? null}
        model={row?.aiModel ?? null}
        keyTail={keyTail}
      />

      <FeishuCard
        boundName={row?.feishuName ?? null}
        boundAtLabel={fmt(row?.feishuBoundAt ?? null)}
        notice={feishu ?? null}
      />
    </main>
  );
}
