import { describe, it, expect } from "vitest";
import { computeMemberLoad, type LoadTask } from "@/lib/member-load";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

function t(id: string, assigneeId: string, dueDate: string | null): LoadTask {
  return { id, title: id, assigneeIds: [assigneeId], status: "todo", dueDate, priority: "medium" };
}

describe("computeMemberLoad 排名", () => {
  it("loadScore 降序为主序，生成唯一 loadRank 1..N 且 rankTotal = 成员数", () => {
    const today = "2026-08-20";
    const members = [
      { id: A, name: "张三" },
      { id: B, name: "李四" },
      { id: C, name: "王五" },
    ];
    // 张三：2 项未完成（1 逾期 + 1 今日）→ 27 分；李四：0 项 → 0 分；王五：0 项 → 0 分
    const tasks = [
      t("t1", A, "2026-08-19"),
      t("t2", A, "2026-08-20"),
    ];
    const rows = computeMemberLoad(members, tasks, today);
    expect(rows.map((r) => r.loadRank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.name)).toEqual(["张三", "李四", "王五"]);
    expect(rows.every((r) => r.rankTotal === 3)).toBe(true);
    expect(rows[0].loadScore).toBeGreaterThan(rows[1].loadScore);
  });

  it("同分按逾期数降序决胜，再按姓名升序保证稳定唯一", () => {
    const today = "2026-08-20";
    const members = [
      { id: A, name: "阿明" },
      { id: B, name: "斑斑" },
    ];
    // 两人都触顶：base 40 + 压力 60 = 100；斑斑逾期 5 项 > 阿明逾期 4 项 → 斑斑第 1
    const tasks = [
      // 阿明：10 项未完成，其中 4 项逾期
      t("a1", A, "2026-08-19"),
      t("a2", A, "2026-08-18"),
      t("a3", A, "2026-08-17"),
      t("a4", A, "2026-08-16"),
      ...Array.from({ length: 6 }, (_, i) => t(`a${i + 5}`, A, null)),
      // 斑斑：10 项未完成，其中 5 项逾期
      t("b1", B, "2026-08-19"),
      t("b2", B, "2026-08-18"),
      t("b3", B, "2026-08-17"),
      t("b4", B, "2026-08-16"),
      t("b5", B, "2026-08-15"),
      ...Array.from({ length: 5 }, (_, i) => t(`b${i + 6}`, B, null)),
    ];
    const rows = computeMemberLoad(members, tasks, today);
    expect(rows.map((r) => r.name)).toEqual(["斑斑", "阿明"]);
    expect(rows[0].loadScore).toBe(100);
    expect(rows[1].loadScore).toBe(100);
    expect(rows[0].loadRank).toBe(1);
    expect(rows[1].loadRank).toBe(2);
  });

  it("完全同分按姓名升序，刷新不跳动", () => {
    const today = "2026-08-20";
    const members = [
      { id: A, name: "阿明" },
      { id: B, name: "斑斑" },
      { id: C, name: "春雨" },
    ];
    const rows = computeMemberLoad(members, [], today);
    expect(rows.map((r) => r.name)).toEqual(["阿明", "斑斑", "春雨"]);
    expect(rows.map((r) => r.loadRank)).toEqual([1, 2, 3]);
  });
});
