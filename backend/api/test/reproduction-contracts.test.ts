import { describe, expect, it } from "vitest";
import {
  createCycleSchema,
  createEventSchema,
  patchEventSchema,
  patchCycleSchema,
  createClutchSchema,
  patchClutchSchema,
  eggSchema,
  patchEggSchema,
  newAnimalSchema, eggMeasurementSchema, incubatorSchema, incubatorMaintenanceSchema, hatchlingCareSchema, reproductiveEventTypeSchema, speciesBreedingProfileSchema,
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


describe("reproduction lifecycle contracts", () => {
  it("accepts only controlled egg lifecycle statuses", () => {
    expect(eggSchema.safeParse({ code: "E-01", status: "fertile" }).success).toBe(true);
    expect(eggSchema.safeParse({ code: "E-02", status: "something-free-text" }).success).toBe(false);
  });

  it("requires a valid hatch date format and accepts a linked hatchling id", () => {
    const animalId = "c0a80101-0000-4000-8000-000000000001";
    expect(patchEggSchema.safeParse({ status: "hatched", hatchedAt: "2026-11-15", offspringAnimalId: animalId }).success).toBe(true);
    expect(patchEggSchema.safeParse({ status: "hatched", hatchedAt: "15/11/2026" }).success).toBe(false);
  });

  it("rejects inverted incubation target ranges", () => {
    expect(createClutchSchema.safeParse({
      cycleId: "c0a80101-0000-4000-8000-000000000001",
      laidOn: "2026-11-15",
      eggCount: 4,
      targetTemperatureMinC: 32,
      targetTemperatureMaxC: 30,
    }).success).toBe(false);
    expect(patchClutchSchema.safeParse({ targetHumidityMinPct: 80, targetHumidityMaxPct: 70 }).success).toBe(false);
  });

  it("accepts individual hatchling genetics, notes and parent links", () => {
    const parentId = "c0a80101-0000-4000-8000-000000000001";
    const parsed = newAnimalSchema.safeParse({
      name: "Hatchling 1", species: "Python regius", sex: "female",
      morph: "Pastel", identifier: "H-001", geneticsNotes: "Possible het clown",
      notes: "First shed complete", motherAnimalId: parentId,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("advanced reproduction contracts", () => {
  it("validates per-egg weight measurements", () => {
    expect(eggMeasurementSchema.safeParse({ measuredAt: "2026-11-15T10:00:00.000Z", weightG: 82.5 }).success).toBe(true);
    expect(eggMeasurementSchema.safeParse({ measuredAt: "2026-11-15T10:00:00.000Z", weightG: 0 }).success).toBe(false);
  });

  it("validates incubator and maintenance data", () => {
    expect(incubatorSchema.safeParse({ name: "Incubatrice 1", capacity: 24 }).success).toBe(true);
    expect(incubatorSchema.safeParse({ name: "", capacity: -1 }).success).toBe(false);
    expect(incubatorMaintenanceSchema.safeParse({ occurredAt: "2026-11-15T10:00:00.000Z", eventType: "calibration" }).success).toBe(true);
    expect(incubatorMaintenanceSchema.safeParse({ occurredAt: "2026-11-15T10:00:00.000Z", eventType: "made-up" }).success).toBe(false);
  });

  it("validates hatchling care milestones and negative reproductive outcomes", () => {
    expect(hatchlingCareSchema.safeParse({ firstFeedingAt: "2026-11-15T10:00:00.000Z", firstFeedingAccepted: true }).success).toBe(true);
    expect(reproductiveEventTypeSchema.safeParse("embryonic_loss").success).toBe(true);
    expect(reproductiveEventTypeSchema.safeParse("made-up").success).toBe(false);
    expect(eggSchema.safeParse({ status: "collapsed" }).success).toBe(true);
  });
});

describe("species breeding profile contract", () => {
  it("accepts optional species-specific maturity and weight thresholds", () => {
    expect(speciesBreedingProfileSchema.safeParse({
      species: "Python regius",
      femaleMinAgeMonths: 36,
      maleMinAgeMonths: 18,
      femaleMinWeightG: 1500,
      maleMinWeightG: 700,
    }).success).toBe(true);
    expect(speciesBreedingProfileSchema.safeParse({
      species: "Python regius",
      femaleMinAgeMonths: -1,
    }).success).toBe(false);
  });
});
