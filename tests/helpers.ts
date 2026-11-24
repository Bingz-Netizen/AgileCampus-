import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE onboarding_progress, notifications, comment_edits, task_comments, task_activities, task_annotations, task_labels, task_assignees, labels, resource_usages, api_tokens, task_dependencies, messages, conversations, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
