import { describe, expect, it } from "vitest";
import {
  getPreferredLocale,
  localizeMessage,
  localizeResponseBody,
  resolveLocale,
} from "../src/i18n/localization.js";

describe("backend localization", () => {
  it("prefers the saved account locale over the browser language", () => {
    expect(resolveLocale({ accountLocale: "en", acceptLanguage: "it-IT,it;q=0.9" })).toBe("en");
    expect(resolveLocale({ accountLocale: "it", acceptLanguage: "en-GB,en;q=0.9" })).toBe("it");
  });

  it("uses the explicitly changed response locale immediately", () => {
    expect(resolveLocale({ responseLocale: "en", accountLocale: "it", acceptLanguage: "it" })).toBe("en");
  });

  it("negotiates supported languages and defaults to Italian", () => {
    expect(getPreferredLocale("fr-FR, en-GB;q=0.9, it-IT;q=0.7")).toBe("en");
    expect(getPreferredLocale("it-IT,it;q=0.9,en;q=0.5")).toBe("it");
    expect(getPreferredLocale("fr-FR, de;q=0.8")).toBe("it");
    expect(getPreferredLocale(undefined)).toBe("it");
  });

  it("localizes stable API messages without changing error codes", () => {
    expect(localizeMessage("Animal not found", "it", "ANIMAL_NOT_FOUND")).toBe("Animale non trovato");
    expect(localizeMessage("Animale non trovato", "en", "ANIMAL_NOT_FOUND")).toBe("Animal not found");
    expect(localizeResponseBody({
      code: "ANIMAL_NOT_FOUND",
      message: "Animal not found",
      requestId: "request-test",
    }, "it")).toMatchObject({
      code: "ANIMAL_NOT_FOUND",
      message: "Animale non trovato",
      requestId: "request-test",
    });
  });

  it("localizes validation details while preserving field paths", () => {
    expect(localizeResponseBody({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: { issues: [{ path: "email", message: "Invalid email address" }] },
    }, "it")).toEqual({
      code: "VALIDATION_ERROR",
      message: "La validazione della richiesta non è riuscita",
      details: { issues: [{ path: "email", message: "Indirizzo email non valido" }] },
    });
  });
});
