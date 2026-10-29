import { describe, expect, it } from "vitest";
import { localDayBounds, zonedDateTimeToUtc } from "../src/modules/operations/time.js";

describe("timezone-aware calendar boundaries", () => {
  it("converts Rome midnight to the correct UTC instant", () => {
    expect(zonedDateTimeToUtc("2026-10-29", "00:00:00", "Europe/Rome").toISOString())
      .toBe("2026-10-28T23:00:00.000Z");
  });

  it("spans a complete local day on an ordinary October date", () => {
    const bounds = localDayBounds("2026-10-29", "Europe/Rome");
    expect(bounds.start.toISOString()).toBe("2026-10-28T23:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-29T23:00:00.000Z");
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("honours 23-hour and 25-hour local days at daylight-saving transitions", () => {
    const springForward = localDayBounds("2026-03-29", "Europe/Rome");
    expect(springForward.start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(springForward.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(springForward.end.getTime() - springForward.start.getTime()).toBe(23 * 60 * 60 * 1000);

    const fallBack = localDayBounds("2026-10-25", "Europe/Rome");
    expect(fallBack.start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(fallBack.end.getTime() - fallBack.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
