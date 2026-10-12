"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

// 跨视图定位高亮：URL ?focus=<taskId> 命中本任务时，滚动到该元素并返回高亮标记。
export function useFocusHighlight<T extends HTMLElement>(taskId: string) {
  const searchParams = useSearchParams();
  const focused = searchParams.get("focus") === taskId;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!focused || !ref.current) return;
    // 延迟一帧，待横向看板容器与纵向页面完成布局后再滚动
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [focused]);

  return { ref, focused };
}
