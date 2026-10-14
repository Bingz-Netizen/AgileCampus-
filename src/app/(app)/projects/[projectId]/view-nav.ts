// 项目页三视图的纯类型与 URL 拼接函数。无 IO、不依赖 React，server/client 共用。
export type ProjectView = "kanban" | "list" | "gantt";

export const VIEWS: ProjectView[] = ["kanban", "list", "gantt"];

export const VIEW_LABEL: Record<ProjectView, string> = {
  kanban: "看板",
  list: "列表",
  gantt: "甘特",
};

export const DEFAULT_VIEW: ProjectView = "kanban";

export function isProjectView(v: unknown): v is ProjectView {
  return typeof v === "string" && (VIEWS as readonly string[]).includes(v);
}

export function parseView(raw: string | string[] | undefined): ProjectView {
  return isProjectView(raw) ? raw : DEFAULT_VIEW;
}

// 在既有 query 上覆写 view（默认视图也显式写入，URL 始终记录当前视图）；
// focus 传 taskId 则写入，否则清除——普通切视图不保留上一次的跨视图高亮。
export function withView(
  params: URLSearchParams,
  view: ProjectView,
  focus?: string | null,
): string {
  const p = new URLSearchParams(params.toString());
  p.set("view", view);
  if (focus) p.set("focus", focus);
  else p.delete("focus");
  return p.toString();
}

// 打开任务详情内嵌视图：保留既有 view/筛选，写入 task，清除跨视图高亮 focus。
export function withTask(params: URLSearchParams, taskId: string): string {
  const p = new URLSearchParams(params.toString());
  p.set("task", taskId);
  p.delete("focus");
  return p.toString();
}

// 关闭任务详情返回项目：仅移除 task 与 focus，保留 view/筛选。
export function withoutTask(params: URLSearchParams): string {
  const p = new URLSearchParams(params.toString());
  p.delete("task");
  p.delete("focus");
  return p.toString();
}
