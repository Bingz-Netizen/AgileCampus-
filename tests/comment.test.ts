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
  markCommentImportant,
  editComment,
  deleteComment,
  listCommentHistory,
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

describe("重要评论标记 / 编辑 / 删除权限", () => {
  beforeEach(resetDb);

  it("student 标记重要被 403 拒绝（含自己的评论）", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "我的结论" });
    await expect(
      markCommentImportant(student.id, c.id, { important: true, type: "decision" }),
    ).rejects.toThrow("仅教师或管理员可标记重要评论");
  });

  it("teacher 可标记任何评论（含他人），决策自动进档案，取消后移除", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "学生结论" });
    const marked = await markCommentImportant(teacher.id, c.id, {
      important: true,
      type: "decision",
    });
    expect(marked.isImportant).toBe(true);
    expect(marked.importanceType).toBe("decision");

    let archives = await listProjectArchives(teacher.id, project.id);
    expect(archives.some((a) => a.id === c.id)).toBe(true);

    await markCommentImportant(teacher.id, c.id, { important: false });
    archives = await listProjectArchives(teacher.id, project.id);
    expect(archives.some((a) => a.id === c.id)).toBe(false);
  });

  it("仅决策/交付自动归档，问题/参考不归档", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c1 = await createComment(student.id, t.id, { content: "交付结论" });
    const c2 = await createComment(student.id, t.id, { content: "待决问题" });
    await markCommentImportant(teacher.id, c1.id, { important: true, type: "delivery" });
    await markCommentImportant(teacher.id, c2.id, { important: true, type: "issue" });
    const archives = await listProjectArchives(teacher.id, project.id);
    expect(archives.some((a) => a.id === c1.id)).toBe(true);
    expect(archives.some((a) => a.id === c2.id)).toBe(false);
  });

  it("仅作者可编辑，非作者被拒，编辑留痕", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "原始" });
    await expect(editComment(teacher.id, c.id, "篡改")).rejects.toThrow(
      "仅评论作者可编辑自己的评论",
    );

    const edited = await editComment(student.id, c.id, "改后");
    expect(edited.content).toBe("改后");
    expect(edited.editCount).toBe(1);
    expect(edited.editedAt).not.toBeNull();

    const history = await listCommentHistory(student.id, c.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ oldContent: "原始", newContent: "改后" });
  });

  it("作者删己、teacher 删任何；student 删他人被拒；软删除留痕", async () => {
    const { owner, student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });

    // teacher 删学生评论
    const c = await createComment(student.id, t.id, { content: "被删" });
    await deleteComment(teacher.id, c.id);
    const after = await listTaskComments(student.id, t.id);
    expect(after.some((x) => x.id === c.id && x.deletedAt !== null)).toBe(true);

    // 作者删己
    const c2 = await createComment(student.id, t.id, { content: "自己删" });
    await expect(deleteComment(student.id, c2.id)).resolves.toMatchObject({
      deletedAt: expect.any(Date),
    });

    // student 删他人（管理员评论）被拒
    const c3 = await createComment(owner.id, t.id, { content: "管理员的评论" });
    await expect(deleteComment(student.id, c3.id)).rejects.toThrow("无权删除该评论");
  });

  it("删除重要评论写入活动日志", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const c = await createComment(student.id, t.id, { content: "重要结论" });
    await markCommentImportant(teacher.id, c.id, { important: true, type: "decision" });
    await deleteComment(teacher.id, c.id);
    const acts = await listTaskActivities(teacher.id, t.id);
    expect(acts.some((a) => a.type === "comment_deleted")).toBe(true);
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

  it("未读优先，且组内按创建时间倒序", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });

    await createComment(student.id, t.id, { content: "旧已读", mentions: [owner.id] });
    const [first] = await listMyMentionNotifications(owner.id);
    await markNotificationRead(owner.id, first.id);

    await createComment(student.id, t.id, { content: "未读甲", mentions: [owner.id] });
    await createComment(student.id, t.id, { content: "未读乙", mentions: [owner.id] });

    const items = await listMyMentionNotifications(owner.id);
    expect(items).toHaveLength(3);
    // 未读在前，已读在后
    expect(items[0].readAt).toBeNull();
    expect(items[1].readAt).toBeNull();
    expect(items[2].readAt).not.toBeNull();
    // 未读组内按创建时间倒序（最新在前，非递增）
    expect(new Date(items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(items[1].createdAt).getTime(),
    );
  });
});
