// 三视图共用的空状态：无数据时统一样式，避免各视图各自为政。
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="ac-card p-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
