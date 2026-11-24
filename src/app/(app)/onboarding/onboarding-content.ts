// 新手引导：步骤文案与「引导手册」介绍内容（纯数据，供向导与手册页共用，避免漂移）。
// 组长/普通成员差异化文案 + 每步一句话敏捷概念 + 锚点选择器（data-onboarding-anchor 定位，缺失时降级）。
// 本模块为客户端安全（不 import db），步骤标签等给客户端用的常量也放这里。

// 步骤整数 → 展示标签（0=身份选择，1..3=三步）
export const ONBOARDING_STEP_LABEL: Record<number, string> = {
  0: "身份选择",
  1: "第1步 建项目",
  2: "第2步 拆任务",
  3: "第3步 用看板",
};

export type OnboardingStepKey = "build_project" | "break_tasks" | "use_board";

export type StepContent = {
  key: OnboardingStepKey;
  number: number; // 1..3
  title: string;
  agile: string; // 一句话敏捷概念
  leader: string[]; // 组长操作说明（2–3 行）
  member: string[]; // 普通成员操作说明
  anchor: string; // data-onboarding-anchor 选择器（用于定位高亮）
};

export const STEP_CONTENT: StepContent[] = [
  {
    key: "build_project",
    number: 1,
    title: "建项目",
    agile: "项目 = 有目标、有里程碑、有交付物。",
    leader: [
      "点击「新建项目」，课程作业 / 大创 / 竞赛 / 毕设模板可一键导入里程碑和任务清单。",
      "给项目定好目标、起止日期与关键里程碑。",
    ],
    member: [
      "了解项目从哪来：组长会用模板建项目，定好目标和里程碑。",
      "进入项目后，你就能看到属于自己的任务。",
    ],
    anchor: "enter-project",
  },
  {
    key: "break_tasks",
    number: 2,
    title: "拆任务",
    agile: "拆任务 = 把大目标拆成可交付的小任务。",
    leader: [
      "拆任务、设负责人、设截止时间、设置前置依赖。",
      "任务要小到一两天能完成，方便跟踪与协作。",
    ],
    member: [
      "任务会被分配给你，可在任务详情看截止时间、依赖和评论。",
      "被 @ 和被分配任务都会收到通知。",
    ],
    anchor: "break-tasks",
  },
  {
    key: "use_board",
    number: 3,
    title: "用看板",
    agile: "看板 = 任务状态可视化：待办 / 进行中 / 已完成。",
    leader: [
      "用看板掌握进度，用负载仪表盘调分工。",
      "用甘特看依赖和延期风险。",
    ],
    member: [
      "拖动自己的任务卡片改变状态。",
      "被 @ 和被分配任务会收到通知。",
    ],
    anchor: "use-board",
  },
];

// 引导手册「三步流程简介」+「敏捷协作轻量概念」
export const HANDBOOK_CONCEPTS = [
  { title: "项目目标", detail: "项目要有清晰目标，用里程碑标记关键节点与交付物。" },
  { title: "任务拆分", detail: "把大目标拆成可交付的小任务，一两天能完成一块。" },
  { title: "看板状态", detail: "用「待办 / 进行中 / 已完成」可视化任务状态，随时掌握进度。" },
] as const;

export const ROLE_LABEL: Record<"leader" | "member", string> = {
  leader: "项目组长",
  member: "普通成员",
};

export const ROLE_DESC: Record<"leader" | "member", string> = {
  leader: "负责建项目、拆任务、分工与盯进度。",
  member: "认领被分配的任务，按时完成并更新状态。",
};

// 「从哪一步开始」选项：完整流程 / 建项目 / 拆任务 / 用看板（value 对应 currentStep 整数）
export const START_STEP_OPTIONS: { label: string; value: number; desc: string }[] = [
  { label: "完整流程", value: 0, desc: "从身份选择开始走完三步" },
  { label: "建项目", value: 1, desc: "直接进入第 1 步" },
  { label: "拆任务", value: 2, desc: "直接进入第 2 步" },
  { label: "用看板", value: 3, desc: "直接进入第 3 步" },
];
