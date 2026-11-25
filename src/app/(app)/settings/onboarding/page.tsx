import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOnboardingProgress, hasAnyProject } from "@/lib/onboarding";
import { OnboardingHandbook } from "./onboarding-handbook";

// 引导手册页（个人中心入口）：展示进度 + 三步简介 + 敏捷概念；可重新开始/继续引导。
export default async function OnboardingHandbookPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [progress, hasProject] = await Promise.all([
    getOnboardingProgress(session.user.id),
    hasAnyProject(session.user.id),
  ]);

  return <OnboardingHandbook initialProgress={progress} hasProject={hasProject} />;
}
