import { z } from "zod";

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  category: string;
  dueAt: string;
  status: "open" | "completed" | "dismissed" | string;
  animalId: string | null;
  animal?: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReminderRuleDto {
  id: string;
  title: string;
  description: string | null;
  category: string;
  intervalDays: number;
  nextDueAt: string;
  animalId: string | null;
  isEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarItemDto {
  id: string;
  title: string;
  type: string;
  start: string;
  status: string;
  targetPath: string | null;
}


const dashboardTaskSchema = z.object({
  id: z.string(), title: z.string(), dueAt: z.string(), status: z.string(),
  animal: z.object({ id: z.string(), name: z.string() }).passthrough().nullable().optional(),
}).passthrough();
const dashboardReminderSchema = z.object({ id: z.string(), title: z.string(), nextDueAt: z.string() }).passthrough();
const dashboardRecentEventSchema = z.object({
  type: z.enum(["feeding", "weight", "shed", "note", "reproduction"]),
  occurredAt: z.string(), title: z.string(), targetPath: z.string(),
}).passthrough();

/** Runtime-checked response contract for GET /home/today. */
export const dashboardTodayResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  tasks: z.object({
    dueToday: z.array(dashboardTaskSchema),
    overdue: z.array(dashboardTaskSchema),
    completedToday: z.array(dashboardTaskSchema),
  }),
  counts: z.object({
    dueToday: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    completedToday: z.number().int().nonnegative(),
    imminentReminders: z.number().int().nonnegative(),
  }),
  truncated: z.object({
    dueToday: z.boolean(), overdue: z.boolean(),
    completedToday: z.boolean(), imminentReminders: z.boolean(),
  }),
  imminentReminders: z.array(dashboardReminderSchema),
  quickActions: z.array(z.object({ key: z.string(), label: z.string(), targetPath: z.string() })).optional(),
  recentEvents: z.array(dashboardRecentEventSchema),
}).passthrough();
export type DashboardTaskDto = z.infer<typeof dashboardTaskSchema>;
export type DashboardTodayDto = z.infer<typeof dashboardTodayResponseSchema>;
export function parseDashboardTodayResponse(value: unknown): DashboardTodayDto {
  return dashboardTodayResponseSchema.parse(value);
}
