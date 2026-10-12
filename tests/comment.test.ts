import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  createTask,
  updateTask,
  addTaskDependency,
  removeTaskDependency,
} from "@/lib/task";
import {
  createComment,
  listTaskComments,
  listTaskActivities,
  countProjectTaskComments,
  listProjectArchives,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markCommentKind,
  listMyMentionNotifications,
} from "@/lib/comment";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, project };
}

describe("任务评论", () => {
  beforeEach(resetDb);

  it("成员可发评论，非成员被拒", async () => {
    const { student, outsider, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "进展如何" });
    expect(c.content).toBe("进展如何");
    await expect(createComment(outsider.id, t.id, { content: "偷看" })).rejects.toThrow(
      "没有权限",
    );
  });

  it("回复的父评论须同属本任务", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const c = await createComment(student.id, a.id, { content: "根评论" });
    await expect(
      createComment(student.id, b.id, { content: "跨任务回复", parentId: c.id }),
    ).rejects.toThrow("不属于该任务");
    await expect(
      createComment(student.id, a.id, { content: "合法回复", parentId: c.id }),
    ).resolves.toMatchObject({ parentId: c.id });
  });

  it("@提及须为团队成员", async () => {
    const { student, outsider, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await expect(
      createComment(student.id, t.id, { content: "看这里", mentions: [outsider.id] }),
    ).rejects.toThrow("不在团队中");
  });

  it("@提及给被提及者生成未读通知，不通知作者自己", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await createComment(student.id, t.id, { content: "请 @owner 过目", mentions: [owner.id, student.id] });
    expect(await countUnreadNotifications(owner.id)).toBe(1);
    expect(await countUnreadNotifications(student.id)).toBe(0);
  });

  it("标记决策后归档进项目档案，取消标记则移除", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "确定用方案 A" });
    await markCommentKind(student.id, c.id, "decision");
    let archives = await listProjectArchives(student.id, project.id);
    expect(archives).toHaveLength(1);
    expect(archives[0].kind).toBe("decision");
    expect(archives[0].taskTitle).toBe("甲");

    await markCommentKind(student.id, c.id, null);
    archives = await listProjectArchives(student.id, project.id);
    expect(archives).toHaveLength(0);
  });

  it("计数按任务聚合", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    await createComment(student.id, a.id, { content: "一" });
    await createComment(student.id, a.id, { content: "二" });
    await createComment(student.id, b.id, { content: "三" });
    const counts = await countProjectTaskComments(student.id, project.id);
    expect(counts[a.id]).toBe(2);
    expect(counts[b.id]).toBe(1);
    expect((await listTaskComments(student.id, a.id)).length).toBe(2);
  });
});

describe("任务活动流", () => {
  beforeEach(resetDb);

  it("状态变更留痕", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await updateTask(student.id, t.id, { status: "doing" });
    await updateTask(student.id, t.id, { status: "done" });
    const acts = await listTaskActivities(student.id, t.id);
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ type: "status_changed", payload: { from: "todo", to: "doing" } });
    expect(acts[1]).toMatchObject({ type: "status_changed", payload: { from: "doing", to: "done" } });
  });

  it("依赖增删留痕", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    await addTaskDependency(student.id, a.id, b.id);
    await removeTaskDependency(student.id, a.id, b.id);
    const acts = await listTaskActivities(student.id, b.id);
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ type: "dependency_added", payload: { predecessorTitle: "甲" } });
    expect(acts[1]).toMatchObject({ type: "dependency_removed" });
  });
});

describe("通知已读", () => {
  beforeEach(resetDb);

  it("单条已读与全部已读", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await createComment(student.id, t.id, { content: "@owner 看", mentions: [owner.id] });
    expect(await countUnreadNotifications(owner.id)).toBe(1);

    const [n] = await listMyMentionNotifications(owner.id);
    await markNotificationRead(owner.id, n.id);
    expect(await countUnreadNotifications(owner.id)).toBe(0);

    // 再发一条，验证全部已读
    await createComment(student.id, t.id, { content: "再来 @owner", mentions: [owner.id] });
    expect(await countUnreadNotifications(owner.id)).toBe(1);
    await markAllNotificationsRead(owner.id);
    expect(await countUnreadNotifications(owner.id)).toBe(0);
  });
});
