import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publicShareFindFirst: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    publicShare: {
      findFirst: mocks.publicShareFindFirst,
    },
  },
}));

import { errorHandler } from "../src/middleware/error-handler.js";
import { createDocumentShareRouter } from "../src/modules/domain/documents-shares.routes.js";

const slug = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const photoKey = "animal-photos/private-photo.jpg";
const updatedAt = new Date("2026-11-11T13:30:00.000Z");

function app() {
  const instance = express();
  instance.use(createDocumentShareRouter());
  instance.use(errorHandler);
  return instance;
}

describe("public animal photo consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not disclose a photo URL or storage key when photo is absent from the allowlist", async () => {
    mocks.publicShareFindFirst.mockResolvedValue({
      visibleFields: ["name", "species"],
      publicDescription: null,
      updatedAt,
      animal: {
        name: "Mango",
        species: "Python regius",
        morph: null,
        sex: "unknown",
        birthDate: null,
        photoKey,
        updatedAt,
      },
    });

    const response = await request(app()).get("/public/animals/" + slug);

    expect(response.status).toBe(200);
    expect(response.body.animal).toEqual({ name: "Mango", species: "Python regius" });
    expect(JSON.stringify(response.body)).not.toContain("photoUrl");
    expect(JSON.stringify(response.body)).not.toContain(photoKey);
  });

  it("returns only an application photo URL when the user explicitly selects photo", async () => {
    mocks.publicShareFindFirst.mockResolvedValue({
      visibleFields: ["name", "photo"],
      publicDescription: "My animal",
      updatedAt,
      animal: {
        name: "Mango",
        species: "Python regius",
        morph: null,
        sex: "unknown",
        birthDate: null,
        photoKey,
        updatedAt,
      },
    });

    const response = await request(app()).get("/public/animals/" + slug);

    expect(response.status).toBe(200);
    expect(response.body.animal).toEqual({
      name: "Mango",
      photoUrl: "/api/v1/public/animals/" + slug + "/photo?v=" + updatedAt.getTime(),
    });
    expect(JSON.stringify(response.body)).not.toContain(photoKey);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex");
  });

  it("never returns a photo URL when no photo exists, even if photo was selected", async () => {
    mocks.publicShareFindFirst.mockResolvedValue({
      visibleFields: ["name", "photo"],
      publicDescription: null,
      updatedAt,
      animal: {
        name: "Mango",
        species: "Python regius",
        morph: null,
        sex: "unknown",
        birthDate: null,
        photoKey: null,
        updatedAt,
      },
    });

    const response = await request(app()).get("/public/animals/" + slug);

    expect(response.status).toBe(200);
    expect(response.body.animal).toEqual({ name: "Mango" });
  });
});
