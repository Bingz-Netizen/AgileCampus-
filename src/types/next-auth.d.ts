import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
    };
    // 登录页「记住我」勾选状态：true=30 天持久，false=会话 cookie。
    // 由中间件据此重写 session cookie 的过期属性。
    remember?: boolean;
  }
}
