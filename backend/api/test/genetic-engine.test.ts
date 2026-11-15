import { describe, expect, it } from "vitest";
import { calculateGenetics, calculateInbreeding } from "../src/modules/domain/genetic-engine.js";

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
  it("recognizes compound heterozygous recessive genotypes", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Compound", inheritanceMode: "autosomal_recessive", motherGenotype: "a1|A", fatherGenotype: "a2|A", referenceAllele: "A", allowedAlleles: ["A", "a1", "a2"] }]);
    expect(result.loci[0]?.outcomes.find((item) => item.genotype === "a1|a2")?.phenotype).toBe("eterozigote composto recessivo (a1/a2)");
  });
  it("does not guess a recessive phenotype without a reference allele", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "No reference", inheritanceMode: "autosomal_recessive", motherGenotype: "a|a", fatherGenotype: "a|a" }]);
    expect(result.loci[0]?.outcomes[0]?.phenotype).toBeNull();
  });
  it("rejects alleles not defined in the selected locus", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Catalogued", inheritanceMode: "codominant", motherGenotype: "A|x", fatherGenotype: "A|A", allowedAlleles: ["A", "a"] }]);
    expect(result.status).toBe("incomplete");
    expect(result.loci[0]?.outcomes).toHaveLength(0);
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
  it("applies complete dominance using the declared reference allele", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Dominant", inheritanceMode: "dominant", motherGenotype: "A|a", fatherGenotype: "A|A", referenceAllele: "a" }]);
    expect(result.loci[0]?.outcomes.find((item) => item.genotype === "A|a")?.phenotype).toBe("espresso");
  });
  it("represents incomplete dominance with an intermediate phenotype", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Incomplete", inheritanceMode: "incomplete_dominant", motherGenotype: "A|a", fatherGenotype: "A|A" }]);
    expect(result.loci[0]?.outcomes.find((item) => item.genotype === "A|a")?.phenotype).toBe("intermedio (A/a)");
  });
  it("applies phenotype rules independent of allele order", () => {
    const result = calculateGenetics([{ locusId: "l1", name: "Rules", inheritanceMode: "codominant", motherGenotype: "A|a", fatherGenotype: "A|A", phenotypeRules: { "a|A": "Patterned" } }]);
    expect(result.loci[0]?.outcomes.find((item) => item.genotype === "A|a")?.phenotype).toBe("Patterned");
  });
  it("combines independent loci as a cartesian product", () => {
    const result = calculateGenetics(["l1", "l2"].map((locusId) => ({ locusId, name: locusId, inheritanceMode: "codominant" as const, motherGenotype: "A|a", fatherGenotype: "A|a" })));
    expect(result.combined).toHaveLength(9);
    expect(result.combined.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(100);
  });
});
describe("calculateInbreeding", () => {
  it("does not report a precise coefficient for incomplete pedigrees", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m" }], "child");
    expect(result.coefficient).toBeNull();
    expect(result.completeness).toBe("partial");
  });
  it("rejects cyclic pedigree paths as incomplete", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "child", fatherId: "f" }, { id: "f" }], "child");
    expect(result.coefficient).toBeNull();
    expect(result.completeness).toBe("partial");
  });
  it("calculates half-sibling parentage as 12.5 percent", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "g", fatherId: "m2" }, { id: "f", motherId: "g", fatherId: "f2" }, { id: "g" }, { id: "m2" }, { id: "f2" }], "child");
    expect(result.coefficient).toBe(0.125);
  });
  it("calculates full-sibling parentage as 25 percent", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "g1", fatherId: "g2" }, { id: "f", motherId: "g1", fatherId: "g2" }, { id: "g1" }, { id: "g2" }], "child");
    expect(result.coefficient).toBe(0.25);
  });
  it("detects first-cousin parentage through shared grandparents", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "p1", fatherId: "p2" }, { id: "f", motherId: "p3", fatherId: "p4" }, { id: "p1", motherId: "gm1", fatherId: "gm2" }, { id: "p3", motherId: "gm1", fatherId: "gm2" }, { id: "p2" }, { id: "p4" }, { id: "gm1" }, { id: "gm2" }], "child");
    expect(result.coefficient).toBe(0.0625);
  });
  it("includes the inbreeding coefficient of a shared ancestor", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "a", fatherId: "m2" }, { id: "f", motherId: "a", fatherId: "f2" }, { id: "a", motherId: "g1", fatherId: "g2" }, { id: "g1", motherId: "h1", fatherId: "h2" }, { id: "g2", motherId: "h1", fatherId: "h2" }, { id: "m2" }, { id: "f2" }, { id: "h1" }, { id: "h2" }], "child");
    expect(result.coefficient).toBe(0.15625);
  });
  it("returns zero for a complete unrelated founder pedigree", () => {
    const result = calculateInbreeding([{ id: "child", motherId: "m", fatherId: "f" }, { id: "m", motherId: "mm", fatherId: "mf" }, { id: "f", motherId: "fm", fatherId: "ff" }, ...["mm","mf","fm","ff"].map((id) => ({ id }))], "child");
    expect(result.coefficient).toBe(0);
  });
});
