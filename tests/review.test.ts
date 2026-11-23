import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask, addTaskDependency } from "@/lib/task";
import {
  addAnnotation,
  approveReview,
  listAnnotations,
  rejectReview,
  submitForReview,
} from "@/lib/review";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const admin = await makeUser("admin@example.com");
  const team = await createTeam(admin.id, "评审测试团队");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const leader = await makeUser("leader@example.com");
  await joinTeam(leader.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, leader.id, "leader");
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "评审演示项目" });
  const task = await createTask(admin.id, project.id, {
    title: "登录页联调",
    assigneeIds: [student.id],
  });
  return { admin, team, student, leader, teacher, project, task };
}

async function statusOf(taskId: string) {
  const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId));
  return row.status;
}

describe("评审状态流转", () => {
  beforeEach(resetDb);

  it("负责人把进行中任务提交评审：doing → review", async () => {
    const { student, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    expect(await statusOf(task.id)).toBe("review");
  });

  it("待办任务不能直接提交评审", async () => {
    const { student, task } = await scene();
    await expect(submitForReview(student.id, task.id)).rejects.toThrow(/进行中|已退回/);
  });

  it("非负责人不能提交评审", async () => {
    const { leader, task } = await scene();
    await updateTask(leader.id, task.id, { status: "doing" });
    await expect(submitForReview(leader.id, task.id)).rejects.toThrow(/负责人/);
  });

  it("教师终审通过：review → done，并写入完成时刻", async () => {
    const { student, teacher, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await approveReview(teacher.id, task.id, "实现没问题");
    expect(await statusOf(task.id)).toBe("done");
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.completedAt).not.toBeNull();
    const notes = await listAnnotations(teacher.id, task.id);
    expect(notes.some((n) => n.kind === "review" && n.content === "实现没问题")).toBe(true);
  });

  it("小组长可退回但不能终审通过", async () => {
    const { student, leader, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);

    await expect(approveReview(leader.id, task.id)).rejects.toThrow(/教师|管理员/);

    await rejectReview(leader.id, task.id, "按钮文案与原型不一致");
    expect(await statusOf(task.id)).toBe("rejected");
    const notes = await listAnnotations(leader.id, task.id);
    expect(notes.some((n) => n.kind === "reject")).toBe(true);
  });

  it("学生不能退回评审", async () => {
    const { student, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await expect(rejectReview(student.id, task.id, "我不满意")).rejects.toThrow(/角色/);
  });

  it("退回原因必填", async () => {
    const { student, leader, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await expect(rejectReview(leader.id, task.id, "   ")).rejects.toThrow(/不能为空/);
  });

  it("已退回可修改后重提：rejected → review", async () => {
    const { student, leader, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await rejectReview(leader.id, task.id, "补充空状态");
    await submitForReview(student.id, task.id);
    expect(await statusOf(task.id)).toBe("review");
  });

  it("终态约束：已完成的任务不能再退回", async () => {
    const { student, teacher, leader, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await approveReview(teacher.id, task.id);
    await expect(rejectReview(leader.id, task.id, "再改改")).rejects.toThrow(/待评审/);
  });

  it("存在未完成前置任务时不能通过评审", async () => {
    const { admin, student, teacher, project, task } = await scene();
    const pre = await createTask(admin.id, project.id, { title: "前置任务" });
    await addTaskDependency(admin.id, pre.id, task.id);
    await updateTask(student.id, task.id, { status: "doing" });
    await submitForReview(student.id, task.id);
    await expect(approveReview(teacher.id, task.id)).rejects.toThrow(/前置任务/);
  });
});

describe("批注", () => {
  beforeEach(resetDb);

  it("全体成员可发批注，空内容被拒", async () => {
    const { student, teacher, task } = await scene();
    await addAnnotation(teacher.id, task.id, { content: "这个交互可以再简化" });
    await addAnnotation(student.id, task.id, { content: "收到，我改一下" });
    const rows = await listAnnotations(student.id, task.id);
    expect(rows).toHaveLength(2);
    await expect(addAnnotation(student.id, task.id, { content: "  " })).rejects.toThrow(/不能为空/);
  });

  it("批注回复不能跨任务挂载", async () => {
    const { admin, student, project, task } = await scene();
    const other = await createTask(admin.id, project.id, { title: "另一个任务" });
    const note = await addAnnotation(student.id, other.id, { content: "另一任务的批注" });
    await expect(
      addAnnotation(student.id, task.id, { content: "挂错任务", parentId: note.id }),
    ).rejects.toThrow(/不属于该任务/);
  });
});
