import type { BurndownPoint } from "@/lib/sprint";

// 燃尽图：纯展示组件（无交互），服务端渲染即可。
// 蓝线=理想剩余，红线=实际剩余（只画到「今天」），两线之间的缺口就是进度偏差。
export function BurndownChart({ points, today }: { points: BurndownPoint[]; today: string }) {
  if (points.length === 0) {
    return <p className="text-sm text-ink-faint">该迭代没有日期区间，无法绘制燃尽图。</p>;
  }

  const W = 720;
  const H = 240;
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxValue = Math.max(
    1,
    ...points.map((p) => Math.max(p.ideal, p.actual ?? 0)),
  );
  const x = (i: number) =>
    points.length === 1 ? pad.left + innerW / 2 : pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / maxValue) * innerH;

  const idealLine = points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(" ");
  const actualPoints = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.actual !== null)
    .map(({ p, i }) => `${x(i)},${y(p.actual as number)}`)
    .join(" ");
  const todayIndex = points.findIndex((p) => p.date === today);

  // 横轴标签最多 8 个，避免日期挤在一起
  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full min-w-[560px]" role="img" aria-label="迭代燃尽图">
        {/* 网格线与纵轴刻度 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maxValue * ratio;
          return (
            <g key={ratio}>
              <line
                x1={pad.left}
                y1={y(value)}
                x2={W - pad.right}
                y2={y(value)}
                stroke="var(--color-line)"
                strokeDasharray="3 4"
              />
              <text x={pad.left - 6} y={y(value) + 4} textAnchor="end" fontSize="10" fill="var(--color-ink-faint)">
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {/* 今日竖线 */}
        {todayIndex >= 0 && (
          <line
            x1={x(todayIndex)}
            y1={pad.top}
            x2={x(todayIndex)}
            y2={pad.top + innerH}
            stroke="var(--color-accent, #b45309)"
            strokeDasharray="4 4"
          />
        )}

        <polyline points={idealLine} fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.55" />
        {actualPoints && (
          <polyline points={actualPoints} fill="none" stroke="var(--color-high)" strokeWidth="2.5" />
        )}

        {/* 横轴日期 */}
        {points.map((p, i) =>
          i % labelStep === 0 || i === points.length - 1 ? (
            <text
              key={p.date}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ink-faint)"
            >
              {p.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 bg-primary opacity-60" /> 理想剩余
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 bg-high" /> 实际剩余
        </span>
        <span>纵轴单位：工时（h）</span>
      </div>
    </div>
  );
}
