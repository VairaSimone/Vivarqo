import { describe, expect, it } from "vitest";
import {
  createCycleSchema,
  createEventSchema,
  patchEventSchema,
  patchCycleSchema,
} from "@vivarqo/contracts/reproduction";

describe("shared reproduction contracts", () => {
  it("applies the default cycle status to valid create payloads", () => {
    const parsed = createCycleSchema.parse({ startedOn: "2026-11-09" });
    expect(parsed.status).toBe("planned");
  });

  it("rejects cycles where the same animal is selected as both parents", () => {
    const animalId = "c0a80101-0000-4000-8000-000000000001";
    const parsed = createCycleSchema.safeParse({
      startedOn: "2026-11-09",
      parentAAnimalId: animalId,
      parentBAnimalId: animalId,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a cycle end date before its start date", () => {
    const parsed = createCycleSchema.safeParse({ startedOn: "2026-11-10", endedOn: "2026-11-09" });
    expect(parsed.success).toBe(false);
  });

  it("validates reproductive-event temperature and humidity bounds", () => {
    expect(createEventSchema.safeParse({
      eventType: "pairing",
      occurredAt: "2026-11-09T10:00:00.000Z",
      temperatureC: 100,
      humidityPct: 100,
    }).success).toBe(true);
    expect(createEventSchema.safeParse({
      eventType: "pairing",
      occurredAt: "2026-11-09T10:00:00.000Z",
      humidityPct: 101,
    }).success).toBe(false);
  });

  it("does not allow empty patch payloads", () => {
    expect(patchEventSchema.safeParse({}).success).toBe(false);
    expect(patchCycleSchema.safeParse({}).success).toBe(false);
  });
});
