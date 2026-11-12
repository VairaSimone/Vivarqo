import { describe, expect, it } from "vitest";
import { parseDashboardTodayResponse } from "@vivarqo/contracts/operations";

const validDashboard = {
  date: "2026-11-12",
  timezone: "Europe/Rome",
  tasks: {
    dueToday: [{ id: "task-1", title: "Feed", dueAt: "2026-11-12T10:00:00.000Z", status: "open", animal: { id: "animal-1", name: "Nala" } }],
    overdue: [],
    completedToday: [],
  },
  counts: { dueToday: 1, overdue: 0, completedToday: 0, imminentReminders: 0 },
  truncated: { dueToday: false, overdue: false, completedToday: false, imminentReminders: false },
  imminentReminders: [],
  quickActions: [],
  recentEvents: [],
};

describe("dashboard response contract", () => {
  it("accepts the shape returned by GET /home/today", () => {
    expect(parseDashboardTodayResponse(validDashboard).tasks.dueToday).toHaveLength(1);
  });

  it("rejects an incompatible response instead of silently rendering empty data", () => {
    expect(() => parseDashboardTodayResponse({
      ...validDashboard,
      counts: { ...validDashboard.counts, dueToday: "one" },
    })).toThrow();
  });
});
