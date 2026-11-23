import { NextResponse, type NextRequest } from "next/server";
import { decode } from "next-auth/jwt";

// 「记住我」的落地处：Auth.js 默认给 session cookie 30 天过期，勾选框语义
// 需要「不勾 = 关浏览器即失效」。本中间件在每次页面响应上按 JWT 里的 remember
// 标记重写 cookie 属性——勾了 → 滚动 30 天；没勾 → 会话 cookie（无过期）。
//
// 注意：中间件跑在 Edge Runtime，不能 import 「@/lib/auth」（它会拉进 db / node:crypto）。
// 因此这里只用 next-auth/jwt 的 decode 解出 payload，不构建完整 NextAuth 实例。

const SESSION_COOKIE = "authjs.session-token";
const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;

export async function middleware(req: NextRequest) {
  const isSecure = req.nextUrl.protocol === "https:";
  const cookieName = isSecure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  const token = req.cookies.get(cookieName)?.value ?? req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();

  let remember: boolean | undefined;
  try {
    const payload = await decode({
      token,
      secret: process.env.AUTH_SECRET ?? "",
      salt: cookieName,
    });
    remember = (payload as { remember?: boolean } | null)?.remember;
  } catch {
    // 令牌损坏/密钥不匹配：交给页面自身的鉴权逻辑处理，不在这里中断请求
    return NextResponse.next();
  }
  if (remember === undefined) return NextResponse.next();

  const res = NextResponse.next();
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecure,
    ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}),
  });
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
