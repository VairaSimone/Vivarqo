import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  animal: { findFirst: vi.fn(), findMany: vi.fn() },
  geneticGene: { findMany: vi.fn(), create: vi.fn() },
  geneticLocus: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  geneticAllele: { create: vi.fn() },
  animalGeneticTrait: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(), delete: vi.fn() },
  animalGeneticTraitHistory: { create: vi.fn(), findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../src/db/prisma.js", () => ({ prisma: mocks }));

import { createGeneticTraitsRouter } from "../src/modules/domain/genetic-traits.routes.js";

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    res.locals.auth = { userId: "00000000-0000-4000-8000-000000000001", sessionId: "session", email: "breeder@example.test", displayName: "Breeder", locale: "it", timezone: "Europe/Rome", emailVerifiedAt: new Date() };
    next();
  });
  server.use(createGeneticTraitsRouter());
  return server;
}

describe("genetic traits API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.$transaction.mockImplementation(async (callback: (tx: typeof mocks) => unknown) => callback(mocks));
  });

  it("scopes catalog reads to the authenticated breeder", async () => {
    mocks.geneticGene.findMany.mockResolvedValue([]);
    await request(app()).get("/genetics/catalog").expect(200).expect({ genes: [] });
    expect(mocks.geneticGene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "00000000-0000-4000-8000-000000000001" },
    }));
  });

  it("creates a gene owned by the authenticated breeder", async () => {
    mocks.geneticGene.create.mockResolvedValue({ id: "gene-1", symbol: "O", name: "Example", species: "Python regius" });
    const response = await request(app()).post("/genetics/genes").send({ species: "Python regius", symbol: "O", name: "Example" }).expect(201);
    expect(response.body.gene.id).toBe("gene-1");
    expect(mocks.geneticGene.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "00000000-0000-4000-8000-000000000001", symbol: "O" }),
    }));
  });

  it("writes an immutable snapshot when a trait is created", async () => {
    mocks.animal.findFirst.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000010" });
    const created = { id: "trait-1", animalId: "00000000-0000-4000-8000-000000000010", traitName: "Albino", traitValue: "Possible", certainty: "possible" };
    mocks.animalGeneticTrait.create.mockResolvedValue(created);
    mocks.animalGeneticTraitHistory.create.mockResolvedValue({ id: "history-1" });
    mocks.auditEvent.create.mockResolvedValue({});
    const response = await request(app())
      .post("/animals/00000000-0000-4000-8000-000000000010/genetic-traits")
      .send({ traitName: "Albino", traitValue: "Possible", certainty: "possible", observedPhenotype: "White" })
      .expect(201);
    expect(response.body.trait.id).toBe("trait-1");
    expect(mocks.animalGeneticTraitHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ traitId: "trait-1", animalId: created.animalId, changedBy: "00000000-0000-4000-8000-000000000001", snapshot: created }),
    }));
  });
});
