import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  getOnboardingProgress,
  updateOnboardingProgress,
  restartOnboarding,
  isOnboardingStudent,
  hasAnyProject,
} from "@/lib/onboarding";
import { resetDb } from "./helpers";
import { db } from "@/db";
import { onboardingProgress } from "@/db/schema";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

describe("onboarding progress", () => {
  beforeEach(resetDb);

  it("新用户无记录=未开始", async () => {
    const u = await makeUser("s@example.com");
    const p = await getOnboardingProgress(u.id);
    expect(p.status).toBe("not_started");
    expect(p.roleType).toBeNull();
    expect(p.currentStep).toBe(0);
  });

  it("推进：not_started → in_progress 补 startedAt 且每用户单行", async () => {
    const u = await makeUser("s@example.com");
    const p = await updateOnboardingProgress(u.id, {
      roleType: "leader",
      currentStep: 1,
      status: "in_progress",
    });
    expect(p.status).toBe("in_progress");
    expect(p.roleType).toBe("leader");
    expect(p.currentStep).toBe(1);
    expect(p.startedAt).not.toBeNull();

    const rows = await db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.userId, u.id));
    expect(rows).toHaveLength(1);
  });

  it("completed / skipped 记时间戳并清对端", async () => {
    const u = await makeUser("s@example.com");
    await updateOnboardingProgress(u.id, { roleType: "member", currentStep: 1, status: "in_progress" });

    const done = await updateOnboardingProgress(u.id, { currentStep: 3, status: "completed" });
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
    expect(done.skippedAt).toBeNull();

    await restartOnboarding(u.id, { roleType: "leader", startStep: 2 });
    const skipped = await updateOnboardingProgress(u.id, { status: "skipped" });
    expect(skipped.status).toBe("skipped");
    expect(skipped.skippedAt).not.toBeNull();
    expect(skipped.completedAt).toBeNull();
  });

  it("restart 重置进度并清 completed/skipped 时间", async () => {
    const u = await makeUser("s@example.com");
    await updateOnboardingProgress(u.id, { roleType: "leader", currentStep: 3, status: "completed" });

    const p = await restartOnboarding(u.id, { roleType: "member", startStep: 0 });
    expect(p.status).toBe("in_progress");
    expect(p.roleType).toBe("member");
    expect(p.currentStep).toBe(0);
    expect(p.completedAt).toBeNull();
    expect(p.skippedAt).toBeNull();
    expect(p.startedAt).not.toBeNull();
  });
});

describe("isOnboardingStudent", () => {
  beforeEach(resetDb);

  it("无团队 / 学生 / 组长均视为学生层（true）", async () => {
    const noTeam = await makeUser("none@example.com");
    expect(await isOnboardingStudent(noTeam.id)).toBe(true);

    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "实验室");
    const student = await makeUser("stu@example.com");
    await joinTeam(student.id, team.inviteCode);
    expect(await isOnboardingStudent(student.id)).toBe(true);

    const leader = await makeUser("leader@example.com");
    await joinTeam(leader.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, leader.id, "leader");
    expect(await isOnboardingStudent(leader.id)).toBe(true);
  });

  it("admin / teacher 不视为学生层（false）", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "实验室");
    expect(await isOnboardingStudent(owner.id)).toBe(false);

    const teacher = await makeUser("teacher@example.com");
    await joinTeam(teacher.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
    expect(await isOnboardingStudent(teacher.id)).toBe(false);
  });
});

describe("hasAnyProject", () => {
  beforeEach(resetDb);

  it("无项目=false，有项目=true", async () => {
    const u = await makeUser("s@example.com");
    expect(await hasAnyProject(u.id)).toBe(false);

    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "实验室");
    await createProject(owner.id, team.id, { name: "课程作业" });
    expect(await hasAnyProject(owner.id)).toBe(true);
  });
});
