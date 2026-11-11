import { describe, expect, it } from "vitest";
import { resolveImportColumnMapping } from "../src/modules/animals/import-column-mapping.js";

const aliases = {
  nome: "name",
  species: "species",
  specie: "species",
  identifier: "identifier",
  identificativo: "identifier",
};

describe("Import column mapping", () => {
  it("recognizes aliases with accents and punctuation normalized", () => {
    const result = resolveImportColumnMapping(
      ["Nome", "Specie", "Identificativo"],
      aliases,
      ["name", "species", "identifier"],
      [["name"], ["species"]],
      undefined,
    );
    expect(result.mappedHeaders).toEqual({
      name: "Nome",
      species: "Specie",
      identifier: "Identificativo",
    });
    expect(result.missingFields).toEqual([]);
    expect(result.unmappedHeaders).toEqual([]);
  });

  it("lets manual assignments override automatic aliases", () => {
    const result = resolveImportColumnMapping(
      ["Nome", "Nome rettile", "Specie animale"],
      aliases,
      ["name", "species"],
      [["name"], ["species"]],
      JSON.stringify({ fields: { name: "Nome rettile", species: "Specie animale" }, ignoredHeaders: ["Nome"] }),
    );
    expect(result.mappedHeaders).toEqual({
      name: "Nome rettile",
      species: "Specie animale",
    });
    expect(result.unmappedHeaders).toEqual(["Nome"]);
    expect(result.missingFields).toEqual([]);
  });

  it("does not re-enable a recognized header explicitly ignored by the user", () => {
    const result = resolveImportColumnMapping(
      ["Nome", "Specie"],
      aliases,
      ["name", "species"],
      [["name"], ["species"]],
      JSON.stringify({ fields: { species: "Specie" }, ignoredHeaders: ["Nome"] }),
    );
    expect(result.mappedHeaders).toEqual({ species: "Specie" });
    expect(result.unmappedHeaders).toEqual(["Nome"]);
    expect(result.missingFields).toEqual([["name"]]);
  });

  it("rejects a header which is both mapped and explicitly ignored", () => {
    expect(() => resolveImportColumnMapping(
      ["Nome", "Specie"],
      aliases,
      ["name", "species"],
      [["name"], ["species"]],
      JSON.stringify({ fields: { name: "Nome" }, ignoredHeaders: ["Nome"] }),
    )).toThrow("IMPORT_MAPPING_DUPLICATE_COLUMN");
  });

  it("reports required fields without failing the preview", () => {
    const result = resolveImportColumnMapping(
      ["Campo sconosciuto"],
      aliases,
      ["name", "species"],
      [["name"], ["species"]],
      undefined,
    );
    expect(result.mappedHeaders).toEqual({});
    expect(result.missingFields).toEqual([["name"], ["species"]]);
    expect(result.unmappedHeaders).toEqual(["Campo sconosciuto"]);
  });

  it("rejects duplicate source columns and invalid field/header names", () => {
    expect(() => resolveImportColumnMapping(
      ["Nome", "Specie"],
      aliases,
      ["name", "species"],
      [["name"], ["species"]],
      JSON.stringify({ fields: { name: "Nome", species: "Nome" }, ignoredHeaders: [] }),
    )).toThrow("IMPORT_MAPPING_DUPLICATE_COLUMN");

    expect(() => resolveImportColumnMapping(
      ["Nome"],
      aliases,
      ["name"],
      [["name"]],
      JSON.stringify({ fields: { unknownField: "Nome" }, ignoredHeaders: [] }),
    )).toThrow("IMPORT_MAPPING_INVALID");
  });
});
