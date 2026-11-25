import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  onboardingProgress,
  projects,
  teamMembers,
  type OnboardingRoleType,
  type OnboardingStatus,
} from "@/db/schema";

export type { OnboardingRoleType, OnboardingStatus } from "@/db/schema";

// 新手引导领域：全局进度（按用户）读写 + 学生判定。权限：仅本用户自己的进度（userId 由路由层从 session 提取，别无旁路）。

// 步骤整数映射：0=身份选择（欢迎页）、1=建项目、2=拆任务、3=用看板。
// 前端「从哪一步开始」：完整流程=0、建项目=1、拆任务=2、用看板=3。
// 说明：本模块会 import db（仅服务端可用）；给客户端的步骤文案/标签放 onboarding-content.ts，勿在此导值给客户端。
export const ONBOARDING_STEP_WELCOME = 0;

export type OnboardingProgressView = {
  status: OnboardingStatus;
  roleType: OnboardingRoleType | null;
  currentStep: number;
  startedAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  updatedAt: Date | null;
};

function toView(row: typeof onboardingProgress.$inferSelect | undefined): OnboardingProgressView {
  if (!row) {
    return {
      status: "not_started",
      roleType: null,
      currentStep: ONBOARDING_STEP_WELCOME,
      startedAt: null,
      completedAt: null,
      skippedAt: null,
      updatedAt: null,
    };
  }
  return {
    status: row.status,
    roleType: row.roleType,
    currentStep: row.currentStep,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    skippedAt: row.skippedAt,
    updatedAt: row.updatedAt,
  };
}

// 读取引导进度；无记录=未开始（不落行，读时归一为 not_started）。
export async function getOnboardingProgress(userId: string): Promise<OnboardingProgressView> {
  const [row] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, userId));
  return toView(row);
}

type ProgressPatch = {
  roleType: OnboardingRoleType | null;
  currentStep: number;
  status: OnboardingStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
};

// 单行 upsert：每用户最多一行，冲突时覆盖（只改引导进度，不触碰业务数据）。
async function upsertProgress(userId: string, patch: ProgressPatch): Promise<OnboardingProgressView> {
  const now = new Date();
  const [row] = await db
    .insert(onboardingProgress)
    .values({ userId, ...patch, updatedAt: now })
    .onConflictDoUpdate({
      target: onboardingProgress.userId,
      set: { ...patch, updatedAt: now },
    })
    .returning();
  return toView(row);
}

// PATCH 语义：只更新传入字段；时间戳按状态联动（进 in_progress 补 startedAt，completed/skipped 记对应时间并清对端）。
export async function updateOnboardingProgress(
  userId: string,
  input: {
    roleType?: OnboardingRoleType;
    currentStep?: number;
    status?: OnboardingStatus;
  },
): Promise<OnboardingProgressView> {
  const existing = await getOnboardingProgress(userId);
  const status = input.status ?? existing.status;
  const now = new Date();

  const startedAt = status === "not_started" ? null : existing.startedAt ?? now;
  const completedAt = status === "completed" ? now : null;
  const skippedAt = status === "skipped" ? now : null;

  return upsertProgress(userId, {
    roleType: input.roleType !== undefined ? input.roleType : existing.roleType,
    currentStep: input.currentStep !== undefined ? input.currentStep : existing.currentStep,
    status,
    startedAt,
    completedAt,
    skippedAt,
  });
}

// 重新开始：重置引导进度（只重置进度，不删除项目/任务/评论等业务数据）。status=in_progress，从 startStep 起。
export async function restartOnboarding(
  userId: string,
  input: { roleType: OnboardingRoleType; startStep: number },
): Promise<OnboardingProgressView> {
  const now = new Date();
  return upsertProgress(userId, {
    roleType: input.roleType,
    currentStep: input.startStep,
    status: "in_progress",
    startedAt: now,
    completedAt: null,
    skippedAt: null,
  });
}

// 学生判定：非 admin/teacher 即视为学生层（可自动触发学生引导）。leader（小组长）仍属学生层，照常触发。
export async function isOnboardingStudent(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), inArray(teamMembers.role, ["admin", "teacher"])))
    .limit(1);
  return row == null;
}

// 是否已有至少一个项目（跨团队）——供第1步「建项目」差异化文案/引导（有项目=进入、无项目=新建/使用模板）。
export async function hasAnyProject(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .limit(1);
  return row != null;
}
