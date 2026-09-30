# AgileCampus 进度总览

**编制日期**：2026-09-30　**基线提交**：`7bb9a46`（初始基线）
**编制方式**：四路独立审计逐图核对作战图交付物与代码，**以源码与测试为唯一证据**，不采信文档自述；全量测试实跑。凡本文写「已完成」者，均有可点开验证的文件路径为凭。

---

## 一句话现状

**十期全部落地，无「未开始」「部分完成」项。** 代码 6,576 行（30 个 `.tsx` + 50 个 `.ts`），测试 30 个文件 / 226 个用例实跑全绿。真正的欠账不在功能，而在三处：**部分模块有代码却零自动化测试、若干文档数字滞后于代码、飞书与真实模型的链路从未真机验收**。

## 测试实跑

```
Test Files  29 passed | 1 skipped (30)
     Tests  224 passed | 2 skipped (226)
  Duration  199.64s                              exit code 0
```

跳过者为 `tests/agent-live.test.ts`——DeepSeek 真打，以 `describe.skipIf(!process.env.DEEPSEEK_API_KEY)` 自守，无密钥时整阵自动跳过，属设计内行为，非失败。

---

## 十期状态总表

| 期 | 主题 | 状态 | 关键实现 | 用例 |
|---|---|---|---|---|
| 图一 | 地基：账号 / 团队 / 三角色权限 | 已完成 | `src/lib/{auth,user,team,password}.ts` | 24 |
| 图二 | 骨架：项目 / 里程碑 / 任务 / 看板 | 已完成 | `src/lib/{project,task}.ts`、`board.tsx` | 24 |
| 图三上 | 对话地基 + 读工具 | 已完成 | `src/lib/agent/{orchestrator,snapshot,conversation,tools}.ts` | 14 |
| 图三下 | 四写兵器 + 两段式确认 | 已完成 | `src/lib/agent/{tools,commit}.ts` | 14 |
| 图四 | 任务增强 + 跨项目总览 | 已完成 | `tasks.completionNote`、`task_dependencies`、`listMyProjects` | 8 |
| 图五 | API Token + 资源占用 + CC 写入 | 已完成 | `src/lib/{api-token,resource}.ts`、`src/app/api/agent/*` | 33 |
| 图六·C | 时间线甘特 | 已完成（测试空缺） | `projects/[projectId]/timeline/page.tsx` | **0** |
| 图七 | 飞书接入（绑定 / 提醒 / 卡片 / 登录） | 已完成 | `src/lib/{feishu,feishu-card,notify}.ts`、`api/auth/feishu/*` | 34 |
| 图八 | AI 修复 + 项目管理 API + 子任务 | 已完成 | `src/lib/agent/{model,snapshot}.ts`、五道读端点 | 35 |
| 一期 | 标签与视图（筛选 / 分组） | 已完成 | `src/lib/{label,board-filters,board-columns}.ts` | 40 |

> 用例数为 `vitest --reporter=json` 实测值，各期之和恰为 226。图八含 2 例自跳的 live 测试。

---

## 缺口清单

### 一、有代码、零自动化测试（回归风险）

| 位置 | 风险 |
|---|---|
| **时间线甘特**（图六·C） | 逻辑全内联在页面组件、未抽 lib，`tests/` 零命中。逾期判定、条宽、里程碑分组三处口径无保护。**风险最高** |
| **看板拖拽**（图二 / 一期） | `moveTaskAction` 无测试；作战图原定的 Playwright 端到端从未落地 |
| **`POST /api/chat` 与 `/api/chat/commit`**（图三上 / 下） | 两个端点在 `tests/` 中零引用，401/400/403 分支与事务回滚仅有代码路径 |
| **`api/feishu/jssdk-config`**（图七 Plan A） | 仅单测 lib 函数与签名串，路由自身无测试 |

另有两处**代码已修、测试未跟**：`snapshot.ts` 的三段 `id=` 与「今天是 YYYY-MM-DD」两处修复（图八），`agent-snapshot.test.ts` 三例均未断言。

### 二、新发现的技术债（本次审计掘出，已补录 BACKLOG）

- **乐观锁存在事务外窗口**：`commit.ts` 先读快照取 `updatedAt`、后开事务写库，读写之间他人的写入检测不到——非事务内 CAS。BACKLOG 原只备案了毫秒竞态与同批重复 taskId。
- **「落列尾」未实现**：`sortOrder` 不在 `updateTask` 白名单，拖后卡片仍按创建时顺序排。
- **两处文档数字过期**：快照上限实为 4000 字符（旧记为 2000）、读工具实为 4 件（旧记为 2 件）。均已就地更正。

### 三、须真机 / 真密钥验收（离线不可代）

| 项 | 缺什么 |
|---|---|
| 飞书 OAuth 绑定与登录 | 真实 AppID/Secret + 重定向白名单 |
| 飞书客户端内 JSSDK 免登 | 真机飞书客户端 |
| 飞书卡片 / 私信投递 | 真实应用 + 已绑定成员 |
| cron 定时提醒实打 | 宿主 crontab + `CRON_SECRET` |
| DeepSeek「拆任务 → 确认 → 落库」 | `DEEPSEEK_API_KEY`；且 live 测试仅断言草案非空，**从不调 `/api/chat/commit` 真落库** |
| 浏览器端到端（拖拽落库、筛选刷新保持、`?task=` 深链） | 无 e2e 工具，仓库无 Playwright |

---

## 建议的下一步（按性价比排序）

1. **给甘特抽 lib 并补测试**——当前唯一「零保护且逻辑复杂」的模块，改动风险最高。
2. **真机验飞书一轮**——凭证齐备后把 OAuth 绑定、免登、卡片投递一次走通，这是十期里唯一整条未经真实环境验证的链路。
3. **补两个对话端点的路由测试**——401/400/403 与事务回滚是「军法」所在，仅有代码路径不足恃。
4. **真机验一轮 AI 助手**——模型番号与 prompt 修复（图八）至今未有成功记录留痕。

---

## 与既有文档的关系

- 本文件是**进度的唯一权威口径**。作战图与 BACKLOG 是过程记录与技术债明细，二者中的数字若与本文件冲突，以本文件为准（本文件以实跑与源码为准）。
- 每张作战图头部已加一行状态结论，指向本文件；作战图内的 `- [ ]` 复选框为历史原态，**未逐条回填，不可据以判断进度**——判断进度看本文件。
- 维护约定：改动功能后，更新本表状态与用例数，并把新债补进 `BACKLOG.md`。
