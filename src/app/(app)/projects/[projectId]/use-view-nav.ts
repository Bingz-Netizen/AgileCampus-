"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { withView, type ProjectView } from "./view-nav";

// 视图切换 / 跨视图定位导航助手：软导航（scroll:false，不整页刷新），
// 并保留既有筛选等 query 参数。统一落到 /projects/[id]，故甘特页也能跳回主页面看板。
export function useViewNav(projectId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(view: ProjectView, focus?: string) {
    const qs = withView(new URLSearchParams(searchParams.toString()), view, focus ?? null);
    router.replace(`/projects/${projectId}?${qs}`, { scroll: false });
  }

  return { go };
}
