import { describe, expect, it } from "vitest";
import { calculateGenetics, calculateInbreeding } from "./genetic-engine.js";

describe("calculateGenetics", () => {
  it("calculates a heterozygous recessive cross", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Albino", inheritanceMode: "autosomal_recessive", motherGenotype: "A|a", fatherGenotype: "A|a", referenceAllele: "A" }]);
    expect(result.status).toBe("complete");
    expect(result.loci[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ genotype: "a|a", probability: 25 }),
      expect.objectContaining({ genotype: "A|a", probability: 50 }),
      expect.objectContaining({ genotype: "A|A", probability: 25 }),
    ]));
  });
  it("marks unknown parental alleles as incomplete instead of guessing", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Unknown", inheritanceMode: "dominant", motherGenotype: "A|?", fatherGenotype: "A|a" }]);
    expect(result.status).toBe("incomplete");
    expect(result.loci[0]?.outcomes).toHaveLength(0);
  });
  it("expresses heterozygotes distinctly for codominance", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Co-dom", inheritanceMode: "codominant", motherGenotype: "A|a", fatherGenotype: "A|A" }]);
    expect(result.loci[0]?.outcomes.find((item) => item.genotype === "A|a")?.phenotype).toBe("A + a");
  });
  it("combines independent loci as a cartesian product", () => {
    const result = calculateGenetics(["l1", "l2"].map((locusId) => ({ locusId, name: locusId, inheritanceMode: "codominant" as const, motherGenotype: "A|a", fatherGenotype: "A|a" })));
    expect(result.combined).toHaveLength(9);
    expect(result.combined.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(100);
  });
});
describe("calculateInbreeding", () => {
  it("does not report a precise coefficient for incomplete pedigrees", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m" }, { id: "f" }], "child");
    expect(result.coefficient).toBeNull();
    expect(result.completeness).toBe("partial");
  });
  it("returns zero for a complete unrelated founder pedigree", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "mm", fatherId: "mf" }, { id: "f", motherId: "fm", fatherId: "ff" }, ...["mm","mf","fm","ff"].map((id) => ({ id }))], "child");
    expect(result.coefficient).toBe(0);
  });
});
