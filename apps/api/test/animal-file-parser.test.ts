import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { parseAnimalFile } from "../src/modules/animals/animal-file-parser.js";

describe("Animal file parser resource limits", () => {
  it("accepts a CSV with the maximum supported column count", () => {
    const headers = Array.from({ length: 256 }, (_, index) => `column${index}`).join(",");
    const values = Array.from({ length: 256 }, (_, index) => `value${index}`).join(",");
    const parsed = parseAnimalFile(Buffer.from(`${headers}\n${values}\n`, "utf8"), "text/csv");

    expect(parsed.headers).toHaveLength(256);
    expect(parsed.rows).toHaveLength(1);
  });

  it("rejects CSVs that exceed the supported column count", () => {
    const headers = Array.from({ length: 257 }, (_, index) => `column${index}`).join(",");
    const values = Array.from({ length: 257 }, () => "value").join(",");
    let thrown: unknown;
    try {
      parseAnimalFile(Buffer.from(`${headers}\n${values}\n`, "utf8"), "text/csv");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: "IMPORT_TOO_MANY_COLUMNS", statusCode: 413 });
  });
});
