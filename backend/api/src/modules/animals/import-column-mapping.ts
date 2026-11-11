export interface ImportColumnMapping {
  mappedHeaders: Record<string, string>;
  unmappedHeaders: string[];
  missingFields: string[][];
}

/**
 * Resolves import headers consistently for animal, care and domain imports.
 * Automatic aliases are defaults; explicit user selections override them.
 */
export function resolveImportColumnMapping(
  headers: string[],
  aliases: Record<string, string>,
  availableFields: readonly string[],
  requiredGroups: readonly (readonly string[])[],
  requestedMapping: unknown,
): ImportColumnMapping {
  const allowed = new Set(availableFields);
  const manual: Record<string, string> = {};

  if (requestedMapping !== undefined) {
    if (typeof requestedMapping !== "string") {
      throw new Error("IMPORT_MAPPING_INVALID");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(requestedMapping);
    } catch {
      throw new Error("IMPORT_MAPPING_INVALID");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("IMPORT_MAPPING_INVALID");
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length > availableFields.length) throw new Error("IMPORT_MAPPING_INVALID");
    for (const [field, header] of entries) {
      if (!allowed.has(field) || typeof header !== "string" || !headers.includes(header)) {
        throw new Error("IMPORT_MAPPING_INVALID");
      }
      manual[field] = header;
    }
  }

  const mappedHeaders: Record<string, string> = {};
  const autoClaims: Record<string, string[]> = {};
  for (const header of headers) {
    const normalized = header.toLocaleLowerCase("it-IT")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
    const field = aliases[normalized];
    if (!field || !allowed.has(field) || Object.prototype.hasOwnProperty.call(manual, field)) continue;
    (autoClaims[field] ??= []).push(header);
  }
  for (const [field, columns] of Object.entries(autoClaims)) {
    // Keep the first automatic match and leave extra columns unassigned so the
    // user can resolve ambiguous source headers in the mapping UI.
    mappedHeaders[field] = columns[0]!;
  }

  for (const [field, header] of Object.entries(manual)) {
    // A source column can feed only one target field.
    for (const [existingField, existingHeader] of Object.entries(mappedHeaders)) {
      if (existingHeader === header) delete mappedHeaders[existingField];
    }
    mappedHeaders[field] = header;
  }

  const claimedHeaders = Object.values(mappedHeaders);
  if (new Set(claimedHeaders).size !== claimedHeaders.length) {
    throw new Error("IMPORT_MAPPING_DUPLICATE_COLUMN");
  }

  const missingFields = requiredGroups
    .filter((group) => !group.some((field) => mappedHeaders[field]))
    .map((group) => [...group]);
  const used = new Set(Object.values(mappedHeaders));
  return {
    mappedHeaders,
    unmappedHeaders: headers.filter((header) => !used.has(header)),
    missingFields,
  };
}
