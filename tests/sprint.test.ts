import { describe, expect, it } from "vitest";
import { buildBurndown, sprintSummary } from "@/lib/sprint";

const sprint = { startDate: "2026-11-16", endDate: "2026-11-20" };
const task = (
  estimateHours: number | null,
  completedAt: string | null,
  status: "todo" | "doing" | "done" = completedAt ? "done" : "todo",
) => ({ estimateHours, completedAt: completedAt ? new Date(`${completedAt}T10:00:00Z`) : null, status });

describe("buildBurndown", () => {
  it("按天递减理想剩余，实际剩余随完成时刻下降", () => {
    const points = buildBurndown(
      sprint,
      [task(3, "2026-11-17"), task(2, null)],
      "2026-11-20",
    );

    expect(points.map((p) => p.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    // 总工作量 5h，理想线从 5 线性降到 0
    expect(points[0].ideal).toBe(5);
    expect(points[4].ideal).toBe(0);
    // 11-16：3h 任务尚未完成 → 剩余 5；11-17 完成 → 剩余 2
    expect(points[0].actual).toBe(5);
    expect(points[1].actual).toBe(2);
    expect(points[4].actual).toBe(2);
  });

  it("未来日期不给实际值（只画到今天）", () => {
    const points = buildBurndown(sprint, [task(4, null)], "2026-11-17");
    expect(points.filter((p) => p.date > "2026-11-17").every((p) => p.actual === null)).toBe(true);
    expect(points.find((p) => p.date === "2026-11-17")?.actual).toBe(4);
  });

  it("未估时的任务不计入曲线，总数也不受影响", () => {
    const points = buildBurndown(sprint, [task(null, null), task(2, null)], "2026-11-20");
    expect(points[0].actual).toBe(2);
    expect(points[0].ideal).toBe(2);
  });

  it("单日迭代不会除以零", () => {
    const points = buildBurndown({ startDate: "2026-11-16", endDate: "2026-11-16" }, [task(3, null)], "2026-11-16");
    expect(points).toHaveLength(1);
    expect(Number.isFinite(points[0].ideal)).toBe(true);
    expect(points[0].actual).toBe(3);
  });

  it("缺日期时退化为单点", () => {
    const points = buildBurndown({ startDate: null, endDate: null }, [task(1, null)], "2026-11-16");
    expect(points).toHaveLength(1);
  });
});

describe("sprintSummary", () => {
  it("汇总任务数、完成数、总工时与剩余工时", () => {
    const s = sprintSummary([task(3, "2026-11-17"), task(2, null), task(null, null)]);
    expect(s).toEqual({ total: 5, done: 1, remaining: 2, count: 3, unestimated: 1 });
  });
});
