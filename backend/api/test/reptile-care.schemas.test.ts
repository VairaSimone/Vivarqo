import { describe, expect, it } from "vitest";
import { reptileBrumationPeriodSchema, reptileFastingPeriodSchema } from "../src/modules/animals/reptile-care.routes.js";

const start = "2026-01-01T12:00:00.000Z";
const end = "2026-01-02T12:00:00.000Z";

describe("reptile care validation", () => {
  it("accepts a fasting/refusal period with optional weight and refusal count", () => {
    const result = reptileFastingPeriodSchema.safeParse({
      periodType: "refusal", startedAt: start, lastAcceptedMealAt: start,
      refusedMealsCount: 3, startWeightG: 820.5, notes: "Three refused meals",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a fasting period whose end precedes its start", () => {
    const result = reptileFastingPeriodSchema.safeParse({ startedAt: end, endedAt: start });
    expect(result.success).toBe(false);
  });

  it("rejects negative refused meal counts and weights", () => {
    expect(reptileFastingPeriodSchema.safeParse({ startedAt: start, refusedMealsCount: -1 }).success).toBe(false);
    expect(reptileFastingPeriodSchema.safeParse({ startedAt: start, startWeightG: -20 }).success).toBe(false);
  });

  it("accepts brumation conditions and rejects invalid humidity", () => {
    expect(reptileBrumationPeriodSchema.safeParse({ startedAt: start, temperatureC: 12, humidityPct: 70, conditions: "Stable" }).success).toBe(true);
    expect(reptileBrumationPeriodSchema.safeParse({ startedAt: start, humidityPct: 120 }).success).toBe(false);
  });

  it("rejects a brumation period whose end precedes its start", () => {
    expect(reptileBrumationPeriodSchema.safeParse({ startedAt: end, endedAt: start }).success).toBe(false);
  });
});
