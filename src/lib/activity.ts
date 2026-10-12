import { db, type DbTx } from "@/db";
import { taskActivities, type TaskActivityType } from "@/db/schema";

// 记录任务活动（状态变更 / 依赖增删），供任务时间线合并展示。
// 事务路径传入 tx 以与主操作同回滚；普通路径直写 db。
export async function recordTaskActivity(input: {
  taskId: string;
  userId: string;
  type: TaskActivityType;
  payload?: Record<string, unknown>;
  tx?: DbTx;
}) {
  const exec = input.tx ?? db;
  await exec.insert(taskActivities).values({
    taskId: input.taskId,
    userId: input.userId,
    type: input.type,
    payload: input.payload ?? {},
  });
}
