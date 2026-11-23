"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction, type FormState } from "./actions";
import { FeishuLogin } from "./feishu-login";

function LoginForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    loginAction,
    null,
  );
  const registered = useSearchParams().get("registered");

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 ac-card p-6">
      <h1 className="font-display text-2xl font-semibold text-ink">登录 AgileCampus</h1>
      {registered && <p className="text-sm text-done">注册成功，请登录。</p>}
      <form action={formAction} className="space-y-3">
        <input name="email" type="email" placeholder="邮箱" className="ac-field" />
        <input name="password" type="password" placeholder="密码" className="ac-field" />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="remember" value="true" defaultChecked className="accent-accent" />
          记住我（30 天内免登录）
        </label>
        {state?.error && <p className="text-sm text-high">{state.error}</p>}
        <button disabled={pending} className="ac-btn w-full">
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
      <p className="text-sm text-ink-soft">
        没有账号？<Link href="/register" className="text-primary hover:underline">去注册</Link>
      </p>
      <FeishuLogin />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
