import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask, addTaskDependency } from "@/lib/task";
import {
  submitReview,
  approveReview,
  rejectReview,
  resubmitReview,
} from "@/lib/task-review";
import { addAnnotation, listAnnotations } from "@/lib/annotation";
import { canMarkImportant } from "@/lib/comment";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const other = await makeUser("other@example.com");
  await joinTeam(other.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const leader = await makeUser("leader@example.com");
  await joinTeam(leader.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, leader.id, "leader");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, other, teacher, leader, outsider, project };
}

// 建一条 doing 且学生为负责人的任务（评审流转的起点）
async function doingTask(studentId: string, projectId: string) {
  const t = await createTask(studentId, projectId, {
    title: "造船",
    assigneeIds: [studentId],
  });
  await updateTask(studentId, t.id, { status: "doing" });
  return t;
}

describe("批注评审流转", () => {
  beforeEach(resetDb);

  it("负责人可提交评审：doing → reviewing；非负责人的普通成员被拒", async () => {
    const { student, other, project } = await scene();
    const t1 = await doingTask(student.id, project.id);
    await expect(submitReview(student.id, t1.id)).resolves.toBeUndefined();
    const t2 = await doingTask(student.id, project.id);
    await expect(submitReview(other.id, t2.id)).rejects.toThrow("没有权限");
  });

  it("小组长可代为提交评审（非负责人）", async () => {
    const { student, leader, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await expect(submitReview(leader.id, t.id)).resolves.toBeUndefined();
  });

  it("todo 直接提交评审被拒（状态机约束）", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, {
      title: "未开工",
      assigneeIds: [student.id],
    });
    await expect(submitReview(student.id, t.id)).rejects.toThrow("当前状态不允许该操作");
  });

  it("教师通过评审：reviewing → done，附评审意见批注（kind=review）", async () => {
    const { student, teacher, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await submitReview(student.id, t.id);
    await approveReview(teacher.id, t.id, "结构完整，通过");
    const list = await listAnnotations(student.id, t.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "review", content: "结构完整，通过" });
    expect(list[0].authorName).toBe(teacher.name);
  });

  it("教师退回：原因必填，写退回批注（kind=rejection）；学生修改后可重提 → reviewing", async () => {
    const { student, teacher, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await submitReview(student.id, t.id);
    await expect(rejectReview(teacher.id, t.id, "  ")).rejects.toThrow("请填写退回原因");
    await rejectReview(teacher.id, t.id, "第三步逻辑有误");
    const list = await listAnnotations(student.id, t.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "rejection", content: "第三步逻辑有误" });
    await expect(resubmitReview(student.id, t.id)).resolves.toBeUndefined();
  });

  it("学生不能执行教师评审动作", async () => {
    const { student, teacher, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await submitReview(student.id, t.id);
    await expect(approveReview(student.id, t.id, "自评通过")).rejects.toThrow("没有权限");
    await expect(rejectReview(student.id, t.id, "自评退回")).rejects.toThrow("没有权限");
  });

  it("非成员不能提交评审；非成员不能读批注", async () => {
    const { student, outsider, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await expect(submitReview(outsider.id, t.id)).rejects.toThrow("没有权限");
    await expect(listAnnotations(outsider.id, t.id)).rejects.toThrow("没有权限");
  });

  it("存在未完成前置任务时不可通过评审（完成-开始依赖校验）", async () => {
    const { student, teacher, project } = await scene();
    const pred = await createTask(student.id, project.id, { title: "备料" });
    const t = await doingTask(student.id, project.id);
    await addTaskDependency(student.id, pred.id, t.id);
    await submitReview(student.id, t.id);
    await expect(approveReview(teacher.id, t.id, "通过")).rejects.toThrow("暂不能通过评审");
  });

  it("师生双向批注与回复；回复须同属本任务", async () => {
    const { student, teacher, project } = await scene();
    const t = await doingTask(student.id, project.id);
    const other = await createTask(student.id, project.id, { title: "另一任务" });
    const root = await addAnnotation(student.id, t.id, { content: "老师看下这个写法" });
    await addAnnotation(teacher.id, t.id, { content: "可以，注意命名", parentId: root.id });
    // 回复指向别的任务下的批注 → 拒绝
    const foreign = await addAnnotation(teacher.id, other.id, { content: "别任务批注" });
    await expect(
      addAnnotation(student.id, t.id, { content: "跨任务回复", parentId: foreign.id }),
    ).rejects.toThrow("被回复的批注不存在");
    const list = await listAnnotations(student.id, t.id);
    expect(list).toHaveLength(2);
    expect(list[0].parentId).toBeNull();
    expect(list[1].parentId).toBe(root.id);
    await expect(addAnnotation(student.id, t.id, { content: " " })).rejects.toThrow(
      "批注内容不可为空",
    );
  });

  it("已完成的任务不可再评审（done 终态）", async () => {
    const { student, teacher, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await submitReview(student.id, t.id);
    await approveReview(teacher.id, t.id);
    await expect(rejectReview(teacher.id, t.id, "再退一次")).rejects.toThrow(
      "当前状态不允许该操作",
    );
    await expect(resubmitReview(student.id, t.id)).rejects.toThrow("当前状态不允许该操作");
  });

  it("小组长可初审退回（附批注），但终审通过被拒；可标记重要评论", async () => {
    const { student, teacher, leader, project } = await scene();
    const t = await doingTask(student.id, project.id);
    await submitReview(student.id, t.id);
    await expect(rejectReview(leader.id, t.id, "命名不规范，退回")).resolves.toBeUndefined();
    const list = await listAnnotations(student.id, t.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "rejection", content: "命名不规范，退回" });
    expect(list[0].authorName).toBe(leader.name);
    await expect(resubmitReview(student.id, t.id)).resolves.toBeUndefined();
    await expect(approveReview(leader.id, t.id, "组长放行")).rejects.toThrow("没有权限");
    await expect(approveReview(teacher.id, t.id, "教师终审通过")).resolves.toBeUndefined();

    // 重要评论标记：leader 可，student 不可
    expect(canMarkImportant("leader")).toBe(true);
    expect(canMarkImportant("student")).toBe(false);
  });
});
