import { describe, expect, it } from "vitest";
import { calculateFeedingMetrics } from "../src/modules/animals/feeding-metrics.js";

const now = new Date("2026-11-15T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("feeding metrics", () => {
  it("calculates elapsed days and next meal from the per-animal interval", () => {
    const result = calculateFeedingMetrics([{ outcome: "ate", performedAt: daysAgo(8) }], 14, now);
    expect(result.daysSinceLastFeeding).toBe(8);
    expect(result.nextMealAt?.toISOString()).toBe("2026-11-21T12:00:00.000Z");
  });

  it("counts consecutive refusals after the latest accepted meal", () => {
    const result = calculateFeedingMetrics([
      { outcome: "refused", performedAt: daysAgo(1) },
      { outcome: "not_offered", performedAt: daysAgo(2) },
      { outcome: "refused", performedAt: daysAgo(3) },
      { outcome: "ate", performedAt: daysAgo(7) },
      { outcome: "refused", performedAt: daysAgo(9) },
    ], 10, now);
    expect(result.consecutiveRefusals).toBe(2);
    expect(result.daysSinceLastFeeding).toBe(7);
  });

  it("calculates acceptance only from offered meals", () => {
    const result = calculateFeedingMetrics([
      { outcome: "unknown", performedAt: daysAgo(1) },
      { outcome: "refused", performedAt: daysAgo(2) },
      { outcome: "ate", performedAt: daysAgo(3) },
      { outcome: "not_offered", performedAt: daysAgo(4) },
      { outcome: "ate", performedAt: daysAgo(5) },
    ], null, now);
    expect(result.acceptedCount).toBe(2);
    expect(result.refusedCount).toBe(1);
    expect(result.offeredCount).toBe(3);
    expect(result.acceptanceRate).toBeCloseTo(2 / 3);
    expect(result.nextMealAt).toBeNull();
  });

  it("does not invent a last meal or next date when no meal was accepted", () => {
    const result = calculateFeedingMetrics([{ outcome: "refused", performedAt: daysAgo(2) }], 7, now);
    expect(result.lastAcceptedAt).toBeNull();
    expect(result.daysSinceLastFeeding).toBeNull();
    expect(result.nextMealAt).toBeNull();
    expect(result.consecutiveRefusals).toBe(1);
  });

  it("returns an undefined acceptance percentage when no meals were offered", () => {
    const result = calculateFeedingMetrics([{ outcome: "not_offered", performedAt: daysAgo(1) }], null, now);
    expect(result.acceptanceRate).toBeNull();
    expect(result.offeredCount).toBe(0);
  });
});
