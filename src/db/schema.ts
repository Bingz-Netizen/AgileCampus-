import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  date,
  doublePrecision,
  index,
  jsonb,
  boolean,
  integer,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// 团队角色：leader（小组长）为第二阶段新增——教师把初审退回与进度盯办下放给小组长，
// 终审通过（→ 已完成）仍只保留给教师/管理员。
export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student", "leader"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // 飞书绑定（一对一，可空=未绑定）：open_id 为应用内用户唯一标识，发私信用之
  feishuOpenId: text("feishu_open_id").unique(),
  feishuName: text("feishu_name"),
  feishuBoundAt: timestamp("feishu_bound_at"),
  // AI 助手个人配置（BYOK）：key 经 AES-256-GCM 加密存储，密钥派生自 AUTH_SECRET；
  // baseUrl 与 model 为明文（非敏感），三者同生共死——清 key 即全清。
  aiApiKeyEnc: text("ai_api_key_enc"),
  aiBaseUrl: text("ai_base_url"),
  aiModel: text("ai_model"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_team_user_unique").on(t.teamId, t.userId)],
);

export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"]);
// 任务状态：第二阶段新增「待评审 / 已退回」两档，流转只允许
// 进行中 → 待评审 → 已完成 / 已退回 → 待评审（其余跳转一律拒绝）。
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done", "review", "rejected"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);
// 任务类型：功能任务 / 缺陷卡（最后一周 D2 起全员提缺陷）
export const taskKindEnum = pgEnum("task_kind", ["feature", "bug"]);
// 缺陷分级：阻断级 / 重要级 / 优化级（D2 组长统一筛选）
export const bugSeverityEnum = pgEnum("bug_severity", ["blocker", "major", "minor"]);
// 缺陷生命周期：待处理 / 处理中 / 已修复 / 验证通过
export const bugStatusEnum = pgEnum("bug_status", ["open", "fixing", "fixed", "verified"]);
export const sprintStatusEnum = pgEnum("sprint_status", ["active", "closed"]);
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type TaskKind = (typeof taskKindEnum.enumValues)[number];
export type BugSeverity = (typeof bugSeverityEnum.enumValues)[number];
export type BugStatus = (typeof bugStatusEnum.enumValues)[number];
export type SprintStatus = (typeof sprintStatusEnum.enumValues)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_team_idx").on(t.teamId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: date("target_date"),
    status: milestoneStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

// 迭代（Sprint）：最后一周用于收敛冲刺——任务归入迭代后可在燃尽图上看剩余工作量。
// 一个项目可建多轮迭代；是否「当前迭代」由 status=active 表达（页面取最新一条 active）。
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: sprintStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sprints_project_idx").on(t.projectId)],
);

// 迭代复盘（D7 小组敏捷复盘会留档）：做得好的 / 待改进的 / 踩坑点，按项目留存。
export const retrospectives = pgTable(
  "retrospectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    wentWell: text("went_well"),
    wentBad: text("went_bad"),
    improvements: text("improvements"),
    pitfalls: text("pitfalls"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("retros_project_idx").on(t.projectId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    // 子任务层级：自引用，空＝顶层任务。父任务删则子任务随之（cascade）。
    // 自引用外键须显式标注 AnyPgColumn，否则 TS 推断成环。
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    completionNote: text("completion_note"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    // ---- 最后一周新增：迭代 / 缺陷卡 / 估时 / 阻塞 ----
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    kind: taskKindEnum("kind").notNull().default("feature"),
    // 缺陷卡字段（kind=bug 时使用）：严重级、生命周期状态、被发现的原始任务
    bugSeverity: bugSeverityEnum("bug_severity"),
    bugStatus: bugStatusEnum("bug_status"),
    relatedTaskId: uuid("related_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    // 预估工时（小时）：燃尽图按它累计剩余工作量；null=未估，按 0 计
    estimateHours: doublePrecision("estimate_hours"),
    // 手工阻塞标记（与「依赖未完成」的自动阻塞互补），附原因便于站会同步
    blocked: boolean("blocked").notNull().default(false),
    blockedReason: text("blocked_reason"),
    // 完成时刻：燃尽图按天取「当天结束时仍剩余的工作量」
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_sprint_idx").on(t.sprintId),
  ],
);

// 任务的批注 / 评审留痕：普通批注、评审意见、退回意见同表，
// parentId 支持「回复」形成一条讨论串；评审意见与退回原因由评审动作自动写入，永久留痕。
export const annotationKindEnum = pgEnum("annotation_kind", ["comment", "review", "reject"]);
export type AnnotationKind = (typeof annotationKindEnum.enumValues)[number];

export const taskAnnotations = pgTable(
  "task_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // 回复关系：指向同任务下的另一条批注，删父批注时子回复置空（保留内容）
    parentId: uuid("parent_id").references((): AnyPgColumn => taskAnnotations.id, {
      onDelete: "set null",
    }),
    kind: annotationKindEnum("kind").notNull().default("comment"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("task_annotations_task_idx").on(t.taskId),
    index("task_annotations_parent_idx").on(t.parentId),
  ],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_idx").on(t.projectId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dep_pair_unique").on(t.predecessorId, t.successorId),
    index("task_dep_predecessor_idx").on(t.predecessorId),
  ],
);

// Personal API Token：CC 等浏览器外调用的认证凭据。
// 明文只生成时返回一次，库中仅存 sha256 hash（高熵 token 无需 bcrypt，且 hash 可建唯一索引供 O(1) 查验）。
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

// 资源占用登记：团队共享资源（服务器/算力等）的占用记录，纯登记无审批。
// endTime 可空=占用中；时长 = endTime - startTime（结束后计算）。
export const resourceUsages = pgTable(
  "resource_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceName: text("resource_name").notNull(),
    purpose: text("purpose"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resource_usages_team_idx").on(t.teamId),
    index("resource_usages_user_idx").on(t.userId),
  ],
);

export const labelColorEnum = pgEnum("label_color", [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

// 标签挂在团队而非项目：实验室内项目多且同质，共享一套免去每建一项目重建之苦。
// 唯一索引建在普通两列，大小写不敏感去重由 lib/label.ts 的 lower() 查询承担。
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);

// 任务负责人（多对多）：一任务可指派多人，删除任务/用户时随 cascade 清除。
// 替代原先 tasks.assignee_id 单列——见 docs/superpowers 里「多负责人」迁移口径。
export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_assignees_user_idx").on(t.userId),
  ],
);

// ---- 协作留痕：任务评论 + 活动流 + 站内通知（二期）----

// 评论的归档标记：重要讨论可标「决策 / 问题 / 交付」，自动进项目档案
export const taskCommentKindEnum = pgEnum("task_comment_kind", [
  "decision",
  "issue",
  "delivery",
]);
export type TaskCommentKind = (typeof taskCommentKindEnum.enumValues)[number];

// 重要评论类型：决策 / 问题 / 交付 / 参考。仅 admin/teacher 可标，其中决策/交付自动进项目档案。
export const commentImportanceTypeEnum = pgEnum("comment_importance_type", [
  "decision",
  "issue",
  "delivery",
  "reference",
]);
export type CommentImportanceType = (typeof commentImportanceTypeEnum.enumValues)[number];

// 活动类型：时间线只合并「状态变更 + 依赖变更 + 评论删除」（评论单独成表）
export const taskActivityTypeEnum = pgEnum("task_activity_type", [
  "status_changed",
  "dependency_added",
  "dependency_removed",
  "comment_deleted",
]);
export type TaskActivityType = (typeof taskActivityTypeEnum.enumValues)[number];

// 站内通知类型：被 @ 提及 / 评审结果
export const notificationTypeEnum = pgEnum("notification_type", ["mention", "review"]);
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

// 附件以 dataURL 内联存 jsonb（无对象存储；MVP 规模可接受，单文件限 3MB）
export type CommentAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 回复：自引用指向被回复的评论，空＝顶层评论。父删则子回复随之。
    parentId: uuid("parent_id").references((): AnyPgColumn => taskComments.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull().$defaultFn(() => []),
    attachments: jsonb("attachments")
      .$type<CommentAttachment[]>()
      .notNull()
      .$defaultFn(() => []),
    kind: taskCommentKindEnum("kind"), // 归档标记（旧字段保留兼容），空＝普通评论
    // 重要评论标记：仅 admin/teacher 可改；decision/delivery 自动进项目档案
    isImportant: boolean("is_important").notNull().default(false),
    importanceType: commentImportanceTypeEnum("importance_type"),
    importantBy: uuid("important_by").references(() => users.id, {
      onDelete: "set null",
    }),
    importantAt: timestamp("important_at"),
    // 编辑留痕：仅作者可编辑，每次编辑 +1 并记时间，旧文入 comment_edits 历史表
    editedAt: timestamp("edited_at"),
    editCount: integer("edit_count").notNull().default(0),
    // 软删除：不物理删除，时间线显示「该评论已删除」，档案保留删除记录
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("task_comments_task_idx").on(t.taskId),
    index("task_comments_parent_idx").on(t.parentId),
  ],
);

// 评论编辑历史：每次编辑留一条「旧文 → 新文」，供「已编辑」悬浮/历史查看
export const commentEdits = pgTable(
  "comment_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => taskComments.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    oldContent: text("old_content").notNull(),
    newContent: text("new_content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("comment_edits_comment_idx").on(t.commentId)],
);

export const taskActivities = pgTable(
  "task_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: taskActivityTypeEnum("type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("task_activities_task_idx").on(t.taskId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => taskComments.id, {
      onDelete: "cascade",
    }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_read_idx").on(t.userId, t.readAt),
  ],
);
