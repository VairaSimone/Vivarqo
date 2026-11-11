import { describe, expect, it } from "vitest";
import { dateFromDateString, dateString, eventDayInTimezone, shiftDate, weekStart } from "./date-utils";

describe("calendar date helpers", () => {
  it("uses account date keys as timezone-independent calendar values", () => {
    const selected = dateFromDateString("2026-11-11");
    expect(dateString(selected)).toBe("2026-11-11");
    expect(dateString(shiftDate(selected, 1))).toBe("2026-11-12");
  });

  it("calculates week boundaries without relying on browser local time", () => {
    const monday = weekStart(dateFromDateString("2026-11-11"));
    expect(dateString(monday)).toBe("2026-11-09");
    expect(dateString(shiftDate(monday, 6))).toBe("2026-11-15");
  });

  it("rejects invalid date keys instead of normalizing them", () => {
    expect(() => dateFromDateString("2026-02-30")).toThrow(/invalid calendar date/i);
    expect(() => dateFromDateString("2026-02-03T00:00:00Z")).toThrow(/invalid calendar date/i);
  });

  it("groups event instants by the requested account timezone", () => {
    expect(eventDayInTimezone("2026-01-02T01:00:00.000Z", "America/Los_Angeles")).toBe("2026-01-01");
    expect(eventDayInTimezone("2026-01-02T01:00:00.000Z", "Asia/Tokyo")).toBe("2026-01-02");
  });
});
