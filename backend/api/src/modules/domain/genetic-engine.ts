export type InheritanceMode = "autosomal_recessive" | "dominant" | "incomplete_dominant" | "codominant";
export interface GeneticLocusInput {
  locusId: string;
  name: string;
  inheritanceMode: InheritanceMode;
  motherGenotype: string;
  fatherGenotype: string;
  referenceAllele?: string | null;
  phenotypeRules?: Record<string, string> | null;
  allowedAlleles?: string[];
  phenotypeRulesConflict?: boolean;
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
  return [a, b].sort((x, y) => x < y ? -1 : x > y ? 1 : 0).join("|");
}
function phenotype(genotype: string, mode: InheritanceMode, referenceAllele?: string | null, rules?: Record<string, string> | null, rulesConflict = false): string | null {
  if (rulesConflict) return null;
  if (rules && Object.prototype.hasOwnProperty.call(rules, genotype)) return rules[genotype]!;
  if (rules) {
    for (const [ruleGenotype, rulePhenotype] of Object.entries(rules)) {
      const rulePair = alleles(ruleGenotype);
      if (rulePair && canonical(rulePair[0], rulePair[1]) === genotype) return rulePhenotype;
    }
  }
  const pair = alleles(genotype);
  if (!pair) return null;
  const [a, b] = pair;
  if (mode === "codominant" && a !== b) return `${a} + ${b}`;
  if (mode === "incomplete_dominant" && a !== b) return `intermedio (${a}/${b})`;
  if (mode === "autosomal_recessive") {
    if (!referenceAllele) return null;
    if (a === referenceAllele || b === referenceAllele) return "non espresso";
    return a === b ? `omozigote recessivo (${a})` : `eterozigote composto recessivo (${a}/${b})`;
  }
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
    if (input.phenotypeRulesConflict) assumptions.push(`${input.name}: regole fenotipo parentali in conflitto; le probabilità genotipiche restano valide ma il fenotipo non viene inferito.`);
    const mother = alleles(input.motherGenotype);
    const father = alleles(input.fatherGenotype);
    if (!mother || !father) {
      incomplete = true;
      loci.push({ locusId: input.locusId, name: input.name, outcomes: [] });
      assumptions.push(`${input.name}: genotipo parentale incompleto o non valido; probabilità non calcolate per questo locus.`);
      continue;
    }
    const allowed = new Set(input.allowedAlleles ?? []);
    if (allowed.size && [...mother, ...father].some((allele) => !allowed.has(allele))) {
      incomplete = true;
      loci.push({ locusId: input.locusId, name: input.name, outcomes: [] });
      assumptions.push(`${input.name}: il genotipo contiene alleli non presenti nel catalogo del locus.`);
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
      phenotype: phenotype(genotype, input.inheritanceMode, input.referenceAllele, input.phenotypeRules, input.phenotypeRulesConflict),
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
export function calculateInbreeding(animals: PedigreeAnimal[], subjectId: string, maxGenerations = 8, cache = new Map<string, InbreedingResult>(), active = new Set<string>()): InbreedingResult {
  const cacheKey = `${subjectId}:${maxGenerations}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (active.has(subjectId)) return { coefficient: null, completeness: "partial", knownAncestors: 0, missingParentLinks: 1, generations: maxGenerations, note: "Ciclo genealogico rilevato." };
  const nextActive = new Set(active);
  nextActive.add(subjectId);
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  if (!byId.has(subjectId)) return { coefficient: null, completeness: "unknown", knownAncestors: 0, missingParentLinks: 0, generations: maxGenerations, note: "Animale non presente nella genealogia fornita." };
  const root = byId.get(subjectId)!;
  if (!root.motherId && !root.fatherId) {
    const founder = { coefficient: 0, completeness: "complete" as const, knownAncestors: 0, missingParentLinks: 0, generations: maxGenerations, note: "Animale trattato come fondatore: i genitori non registrati sono assunti non imparentati." };
    cache.set(cacheKey, founder);
    return founder;
  }
  const missing = new Set<string>();
  const ancestors = new Set<string>();
  const paths = new Map<string, Array<{ side: "maternal" | "paternal"; generation: number; path: string[] }>>();
  const walk = (id: string, path: string[], generation: number, side: "maternal" | "paternal") => {
    const animal = byId.get(id);
    if (!animal) { missing.add(id); return; }
    if (generation > maxGenerations) {
      if (animal.motherId || animal.fatherId) missing.add(`depth-limit:${id}`);
      return;
    }
    ancestors.add(id);
    const parents = [animal.motherId, animal.fatherId];
    if (Boolean(parents[0]) !== Boolean(parents[1])) missing.add(`${id}:unknown-parent`);
    for (const parentId of parents) {
      if (!parentId) continue; // Two absent parent links identify a recorded founder.
      if (path.includes(parentId)) { missing.add(`cycle:${parentId}`); continue; }
      const nextPath = [...path, parentId];
      const entries = paths.get(parentId) ?? [];
      // generation is the number of meioses from this parent to the common ancestor.
      entries.push({ side, generation, path: nextPath });
      paths.set(parentId, entries);
      walk(parentId, nextPath, generation + 1, side);
    }
  };
  if (!root.motherId || !root.fatherId) missing.add("root-parent");
  if (root.motherId) walk(root.motherId, [subjectId], 1, "maternal");
  if (root.fatherId) walk(root.fatherId, [subjectId], 1, "paternal");
  let estimate = 0;
  for (const [ancestorId, entries] of paths) {
    const maternal = entries.filter((entry) => entry.side === "maternal");
    const paternal = entries.filter((entry) => entry.side === "paternal");
    for (const left of maternal) for (const right of paternal) {
      // Do not count an ancestor again when a closer common ancestor already lies
      // on both paths; its own inbreeding coefficient accounts for that loop.
      const hasCloserCommonAncestor = [...paths.keys()].some((otherId) =>
        otherId !== ancestorId && left.path.includes(otherId) && right.path.includes(otherId),
      );
      if (hasCloserCommonAncestor) continue;
      const remainingGenerations = Math.max(0, maxGenerations - Math.max(left.generation, right.generation));
      const ancestorInbreeding = calculateInbreeding(animals, ancestorId, remainingGenerations, cache, nextActive);
      if (ancestorInbreeding.coefficient === null) {
        missing.add(`ancestor-incomplete:${ancestorId}`);
        continue;
      }
      estimate += Math.pow(0.5, left.generation + right.generation + 1) * (1 + ancestorInbreeding.coefficient);
    }
  }
  const complete = missing.size === 0;
  const result: InbreedingResult = {
    coefficient: complete ? Number(estimate.toFixed(6)) : null,
    completeness: complete ? "complete" : ancestors.size ? "partial" : "unknown",
    knownAncestors: ancestors.size, missingParentLinks: missing.size, generations: maxGenerations,
    note: complete ? "Coefficiente di Wright stimato sui percorsi registrati; gli animali senza genitori registrati sono assunti fondatori non imparentati." : "Genealogia incompleta, ciclica o oltre il limite di generazioni: coefficiente non pubblicato per evitare falsa precisione.",
  };
  if (result.coefficient !== null) cache.set(cacheKey, result);
  return result;
}
