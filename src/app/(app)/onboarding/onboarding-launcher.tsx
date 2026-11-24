"use client";

import { useEffect, useState } from "react";
import type { OnboardingProgressView } from "@/lib/onboarding";
import { OnboardingFlow } from "./onboarding-flow";

// 自动触发入口（挂在已登录 layout）：学生且进度为 not_started / in_progress 时自动弹出一次。
// 判定依据是后端 progress（layout 服务端拉取）；sessionStorage 仅作「本会话已触发」缓存，
// 避免同一会话内每次导航都重新弹出；新标签/新登录（sessionStorage 清空）时按后端进度续播。

const AUTO_SHOWN_KEY = "agilecampus_onboarding_auto_shown";

export function OnboardingLauncher({
  autoTrigger,
  progress,
  hasProject,
}: {
  autoTrigger: boolean;
  progress: OnboardingProgressView;
  hasProject: boolean;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!autoTrigger) return;
    try {
      if (sessionStorage.getItem(AUTO_SHOWN_KEY)) return;
      sessionStorage.setItem(AUTO_SHOWN_KEY, "1");
    } catch {
      // sessionStorage 不可用时退化为仅本次挂载触发一次
    }
    // 挂载后读外部存储（sessionStorage）决定是否展示，属与外部系统同步，非渲染期可推导状态，显式豁免该规则。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
  }, [autoTrigger]);

  if (!show) return null;

  // 进行中续播当前步；未开始从身份选择（欢迎页）起
  const startStep = progress.status === "in_progress" ? progress.currentStep : 0;

  return (
    <OnboardingFlow
      initialProgress={progress}
      startStep={startStep}
      hasProject={hasProject}
      onClose={() => setShow(false)}
    />
  );
}
