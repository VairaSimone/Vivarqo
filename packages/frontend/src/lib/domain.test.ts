import { describe, expect, it } from "vitest";
import { amountToCents, centsToAmount, dateForInput, dateTimeInputToUtc, dateTimeInputValue, formatDate, formatMoneyCents, getString, queryString, setDisplayPreferences, todayDate, weightToGrams, gramsToWeight, temperatureToCelsius, celsiusToTemperature } from "./domain";

describe("monetary helpers", () => {
  it("converts decimal euro amounts to integer cents without floating point drift", () => {
    expect(amountToCents("12,34")).toBe(1234);
    expect(amountToCents("0.10")).toBe(10);
    expect(centsToAmount("123456789012345")).toBe(1234567890123.45);
    expect(formatMoneyCents("1234", "it")).toContain("12,34");
  });

  it.each(["", "-1", "1.234", "1,234", "01.00", "0"])("rejects invalid or non-positive amounts: %s", (value) => {
    expect(() => amountToCents(value)).toThrow();
  });
});

describe("domain formatting helpers", () => {
  it("formats date-only values without shifting the day through UTC", () => {
    expect(formatDate("2026-11-02", "it")).toContain("2026");
  });

  it("converts account units while retaining canonical gram and Celsius storage", () => {
    expect(weightToGrams(1, "lb")).toBeCloseTo(453.59237, 5);
    expect(gramsToWeight(1000, "kg")).toBe(1);
    expect(temperatureToCelsius(32, "f")).toBe(0);
    expect(celsiusToTemperature(100, "f")).toBe(212);
  });

  it("applies explicit account date formats without shifting date-only values", () => {
    setDisplayPreferences({ dateFormat: "dd/MM/yyyy", timezone: "Europe/Rome" });
    expect(formatDate("2026-11-02", "it")).toBe("02/11/2026");
    setDisplayPreferences({ dateFormat: "locale", weightUnit: "g", temperatureUnit: "c", compactTables: false });
  });

  it("omits empty query string fields and preserves falsy numeric values", () => {
    expect(queryString({ page: 0, q: "", active: false, nil: null })).toBe("?page=0&active=false");
  });

  it("converts number fields to display strings without treating objects as strings", () => {
    expect(getString({ weightG: 1250 }, "weightG")).toBe("1250");
    expect(getString({ animal: { name: "Nala" } }, "animal")).toBe("");
  });
});


describe("account timezone helpers", () => {
  it("formats a stored instant in the account timezone, not the runtime timezone", () => {
    setDisplayPreferences({ timezone: "America/Los_Angeles", dateFormat: "locale" });
    const instant = "2026-01-02T01:00:00.000Z";
    expect(dateForInput(instant)).toBe("2026-01-01");
    expect(formatDate(instant, "en")).toBe("Jan 1, 2026");
    expect(todayDate(new Date(instant), "America/Los_Angeles")).toBe("2026-01-01");
    // A date-only value remains a calendar date and is never shifted.
    expect(dateForInput("2026-01-02")).toBe("2026-01-02");
  });

  it("round-trips datetime-local values through an account timezone", () => {
    expect(dateTimeInputValue("2026-11-11T12:00:00.000Z", "Asia/Tokyo")).toBe("2026-11-11T21:00");
    expect(dateTimeInputToUtc("2026-11-11T21:00", "Asia/Tokyo")).toBe("2026-11-11T12:00:00.000Z");
  });

  it("handles the repeated hour at the end of daylight saving time deterministically", () => {
    const local = "2026-10-25T02:30";
    const utc = dateTimeInputToUtc(local, "Europe/Rome");
    expect(utc).toBe("2026-10-25T01:30:00.000Z");
    expect(dateTimeInputValue(utc, "Europe/Rome")).toBe(local);
  });

  it("rejects a wall-clock time that does not exist when daylight saving time starts", () => {
    expect(() => dateTimeInputToUtc("2026-03-29T02:30", "Europe/Rome")).toThrow(/does not exist/i);
  });

  it("formats timestamps using the account day even when UTC and local dates differ", () => {
    setDisplayPreferences({ timezone: "Europe/Rome", dateFormat: "locale" });
    expect(formatDate("2026-11-02T23:30:00.000Z", "en")).toBe("Nov 3, 2026");
    setDisplayPreferences({ weightUnit: "g", temperatureUnit: "c", dateFormat: "locale", compactTables: false, timezone: "Europe/Rome" });
  });
});
