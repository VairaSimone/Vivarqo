export type InheritanceMode = "autosomal_recessive" | "dominant" | "incomplete_dominant" | "codominant";
export interface GeneticLocusInput {
  locusId: string;
  name: string;
  inheritanceMode: InheritanceMode;
  motherGenotype: string;
  fatherGenotype: string;
  referenceAllele?: string | null;
  phenotypeRules?: Record<string, string> | null;
}
export interface GenotypeOutcome { genotype: string; probability: number; phenotype: string | null }
export interface LocusOutcome { locusId: string; name: string; outcomes: GenotypeOutcome[] }
export interface GeneticCalculation {
  status: "complete" | "incomplete";
  assumptions: string[];
  loci: LocusOutcome[];
  combined: Array<{ genotypes: Record<string, string>; probability: number }>;
}
function alleles(genotype: string): [string, string] | null {
  const value = genotype.trim();
  if (value.includes("|")) {
    const parts = value.split("|").map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => !part || part === "?")) return null;
    return [parts[0]!, parts[1]!];
  }
  if (value.length === 2 && /^[A-Za-z]{2}$/.test(value)) return [value[0]!, value[1]!];
  return null;
}
function canonical(a: string, b: string): string {
  return [a, b].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })).join("|");
}
function phenotype(genotype: string, mode: InheritanceMode, referenceAllele?: string | null, rules?: Record<string, string> | null): string | null {
  if (rules && Object.prototype.hasOwnProperty.call(rules, genotype)) return rules[genotype]!;
  const pair = alleles(genotype);
  if (!pair) return null;
  const [a, b] = pair;
  if (mode === "codominant" && a !== b) return `${a} + ${b}`;
  if (mode === "incomplete_dominant" && a !== b) return `intermedio (${a}/${b})`;
  if (mode === "autosomal_recessive") return a === b && (!referenceAllele || a !== referenceAllele) ? `omozigote recessivo (${a})` : "non espresso";
  if (mode === "dominant") {
    if (!referenceAllele) return null;
    return a !== referenceAllele || b !== referenceAllele ? "espresso" : "non espresso";
  }
  return a === b ? a : null;
}
function gametes(pair: [string, string]): string[] { return pair[0] === pair[1] ? [pair[0]] : [pair[0], pair[1]]; }

export function calculateGenetics(inputs: GeneticLocusInput[]): GeneticCalculation {
  if (!inputs.length) return { status: "incomplete", assumptions: ["Nessun locus selezionato."], loci: [], combined: [] };
  const assumptions = ["Ereditarietà mendeliana diploide per locus.", "Loci considerati indipendenti: linkage e ricombinazione non sono modellati.", "Le probabilità sono teoriche, non una previsione certa del fenotipo."];
  let incomplete = false;
  const loci: LocusOutcome[] = [];
  for (const input of inputs) {
    const mother = alleles(input.motherGenotype);
    const father = alleles(input.fatherGenotype);
    if (!mother || !father) {
      incomplete = true;
      loci.push({ locusId: input.locusId, name: input.name, outcomes: [] });
      assumptions.push(`${input.name}: genotipo parentale incompleto o non valido; probabilità non calcolate per questo locus.`);
      continue;
    }
    const counts = new Map<string, number>();
    const maternalGametes = gametes(mother), paternalGametes = gametes(father);
    for (const ma of maternalGametes) for (const pa of paternalGametes) {
      const key = canonical(ma, pa);
      counts.set(key, (counts.get(key) ?? 0) + 1 / (maternalGametes.length * paternalGametes.length));
    }
    const outcomes = [...counts.entries()].map(([genotype, probability]) => ({
      genotype, probability: Number((probability * 100).toFixed(4)),
      phenotype: phenotype(genotype, input.inheritanceMode, input.referenceAllele, input.phenotypeRules),
    })).sort((a, b) => a.genotype.localeCompare(b.genotype));
    loci.push({ locusId: input.locusId, name: input.name, outcomes });
  }
  const computable = loci.filter((locus) => locus.outcomes.length);
  let combined: GeneticCalculation["combined"] = [{ genotypes: {}, probability: 1 }];
  for (const locus of computable) {
    combined = combined.flatMap((entry) => locus.outcomes.map((outcome) => ({
      genotypes: { ...entry.genotypes, [locus.locusId]: outcome.genotype },
      probability: entry.probability * outcome.probability / 100,
    })));
    if (combined.length > 4096) throw new Error("Too many combined outcomes; split the calculation into smaller locus groups.");
  }
  return { status: incomplete ? "incomplete" : "complete", assumptions, loci, combined: combined.map((item) => ({ ...item, probability: Number((item.probability * 100).toFixed(6)) })) };
}

export interface PedigreeAnimal { id: string; motherId?: string | null; fatherId?: string | null }
export interface InbreedingResult { coefficient: number | null; completeness: "complete" | "partial" | "unknown"; knownAncestors: number; missingParentLinks: number; generations: number; note: string }
export function calculateInbreeding(animals: PedigreeAnimal[], subjectId: string, maxGenerations = 8): InbreedingResult {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  if (!byId.has(subjectId)) return { coefficient: null, completeness: "unknown", knownAncestors: 0, missingParentLinks: 0, generations: maxGenerations, note: "Animale non presente nella genealogia fornita." };
  const missing = new Set<string>();
  const ancestors = new Set<string>();
  const paths = new Map<string, number[]>();
  const walk = (id: string, path: number[], generation: number) => {
    if (generation > maxGenerations) return;
    const animal = byId.get(id);
    if (!animal) { missing.add(id); return; }
    for (const [index, parentId] of [animal.motherId, animal.fatherId].entries()) {
      if (!parentId) {\n        if (Boolean(animal.motherId) !== Boolean(animal.fatherId)) missing.add(`${id}:${index}`);\n        continue;\n      }
      if (path.includes(parentId)) { missing.add(`cycle:${parentId}`); continue; }
      ancestors.add(parentId);
      const next = [...path, parentId];
      const existing = paths.get(parentId) ?? [];
      paths.set(parentId, [...existing, generation + 1]);
      walk(parentId, next, generation + 1);
    }
  };
  const root = byId.get(subjectId)!;
  if (!root.motherId || !root.fatherId) missing.add("root-parent");
  if (root.motherId) walk(root.motherId, [subjectId], 1);
  if (root.fatherId) walk(root.fatherId, [subjectId], 1);
  // The path-overlap estimate is intentionally conservative: exact Wright F requires
  // complete parent paths and inbreeding coefficients for common ancestors.
  const common = [...paths.entries()].filter(([, generations]) => generations.length > 1);
  const estimate = common.reduce((sum, [, generations]) => {
    const sorted = [...generations].sort((a, b) => a - b);
    return sum + Math.pow(0.5, sorted[0]! + sorted[1]! + 1);
  }, 0);
  const complete = missing.size === 0;
  return {
    coefficient: complete ? Number(estimate.toFixed(6)) : null,
    completeness: complete ? "complete" : ancestors.size ? "partial" : "unknown",
    knownAncestors: ancestors.size, missingParentLinks: missing.size, generations: maxGenerations,
    note: complete ? "Stima da percorsi genealogici registrati; gli antenati fondatori sono assunti non imparentati." : "Genealogia incompleta: coefficiente non pubblicato per evitare una falsa precisione. Integra i genitori mancanti.",
  };
}
