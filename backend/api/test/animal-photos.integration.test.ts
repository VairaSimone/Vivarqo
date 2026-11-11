import express from "express";
import { Readable } from "node:stream";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  animalFindFirst: vi.fn(),
  animalUpdate: vi.fn(),
  auditCreate: vi.fn(),
  publicShareFindFirst: vi.fn(),
  transaction: vi.fn(),
  validateImage: vi.fn(),
  storeObject: vi.fn(),
  deleteObject: vi.fn(),
  openObject: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    animal: {
      findFirst: mocks.animalFindFirst,
      update: mocks.animalUpdate,
    },
    publicShare: { findFirst: mocks.publicShareFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../src/modules/domain/private-storage.js", () => ({
  validatePrivateImage: mocks.validateImage,
  storePrivateObject: mocks.storeObject,
  deletePrivateObject: mocks.deleteObject,
  openPrivateObjectStream: mocks.openObject,
}));

import { errorHandler } from "../src/middleware/error-handler.js";
import { createAnimalPhotoRouter } from "../src/modules/domain/animal-photos.routes.js";

const animalId = "9a8c4514-8958-4e0b-a5f0-b68c2c7a2c3d";
const ownerId = "2b9e9bde-8a14-4f37-9de9-36d5c3a44e12";
const uploadedBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const storedAt = new Date("2026-11-11T12:00:00.000Z");

function authenticatedApp() {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.auth = { userId: ownerId, sessionId: "test-session" };
    next();
  });
  app.use(createAnimalPhotoRouter());
  app.use(errorHandler);
  return app;
}

function anonymousApp() {
  const app = express();
  app.use(createAnimalPhotoRouter());
  app.use(errorHandler);
  return app;
}

describe("animal photo upload lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.animalFindFirst.mockResolvedValue({ id: animalId, photoKey: null });
    mocks.animalUpdate.mockResolvedValue({ id: animalId, updatedAt: storedAt });
    mocks.auditCreate.mockResolvedValue({});
    mocks.publicShareFindFirst.mockResolvedValue(null);
    mocks.openObject.mockResolvedValue({ stream: Readable.from([uploadedBytes]), sizeBytes: uploadedBytes.length });
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      animal: {
        findFirst: mocks.animalFindFirst,
        update: mocks.animalUpdate,
      },
      auditEvent: { create: mocks.auditCreate },
    }));
    mocks.validateImage.mockReturnValue({ mimeType: "image/jpeg", extension: "jpg" });
    mocks.storeObject.mockResolvedValue("animal-photos/new-photo.jpg");
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it("streams a private photo only after confirming the authenticated owner", async () => {
    mocks.animalFindFirst.mockResolvedValue({ id: animalId, photoKey: "animal-photos/private-photo.jpg" });

    const response = await request(authenticatedApp()).get("/animals/" + animalId + "/photo");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(mocks.animalFindFirst).toHaveBeenCalledWith({
      where: { id: animalId, userId: ownerId },
      select: { photoKey: true },
    });
    expect(mocks.openObject).toHaveBeenCalledWith("animal-photos/private-photo.jpg", 5 * 1024 * 1024);
  });

  it("does not serve a public photo when the share allowlist excludes it", async () => {
    mocks.publicShareFindFirst.mockResolvedValue({
      visibleFields: ["name", "species"],
      animal: { photoKey: "animal-photos/public-photo.jpg" },
    });

    const response = await request(anonymousApp()).get("/public/animals/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/photo");

    expect(response.status).toBe(404);
    expect(mocks.openObject).not.toHaveBeenCalled();
  });

  it("serves a public photo only when the share explicitly includes photo", async () => {
    mocks.publicShareFindFirst.mockResolvedValue({
      visibleFields: ["name", "photo"],
      animal: { photoKey: "animal-photos/public-photo.jpg" },
    });

    const response = await request(anonymousApp()).get("/public/animals/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/photo");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex");
    expect(mocks.openObject).toHaveBeenCalledWith("animal-photos/public-photo.jpg", 5 * 1024 * 1024);
  });

  it("checks ownership before creating a private object", async () => {
    mocks.animalFindFirst.mockResolvedValue(null);

    const response = await request(authenticatedApp())
      .post("/animals/" + animalId + "/photo")
      .set("Content-Type", "image/jpeg")
      .send(uploadedBytes);

    expect(response.status).toBe(404);
    expect(mocks.storeObject).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not stream a photo when the requested animal is not owned by the account", async () => {
    mocks.animalFindFirst.mockResolvedValue(null);

    const response = await request(authenticatedApp()).get("/animals/" + animalId + "/photo");

    expect(response.status).toBe(404);
    expect(mocks.openObject).not.toHaveBeenCalled();
  });

  it("uploads the validated image and records the photo URL without exposing its storage key", async () => {
    const response = await request(authenticatedApp())
      .post("/animals/" + animalId + "/photo")
      .set("Content-Type", "image/jpeg")
      .send(uploadedBytes);

    expect(response.status).toBe(200);
    expect(response.body.photoUrl).toBe("/api/v1/animals/" + animalId + "/photo?v=" + storedAt.getTime());
    expect(JSON.stringify(response.body)).not.toContain("animal-photos/");
    expect(mocks.validateImage).toHaveBeenCalledWith(uploadedBytes, "image/jpeg");
    expect(mocks.storeObject).toHaveBeenCalledWith("animal-photos", "jpg", uploadedBytes);
    expect(mocks.animalUpdate).toHaveBeenCalledWith({
      where: { id: animalId },
      data: { photoKey: "animal-photos/new-photo.jpg" },
      select: { id: true, updatedAt: true },
    });
  });

  it("replaces an existing photo and deletes the previous private object", async () => {
    mocks.animalFindFirst.mockResolvedValue({ id: animalId, photoKey: "animal-photos/old-photo.jpg" });

    const response = await request(authenticatedApp())
      .post("/animals/" + animalId + "/photo")
      .set("Content-Type", "image/jpeg")
      .send(uploadedBytes);

    expect(response.status).toBe(200);
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith("animal-photos/old-photo.jpg");
  });

  it("does not clear or delete a photo when the animal is not owned by the account", async () => {
    mocks.animalFindFirst.mockResolvedValue(null);

    const response = await request(authenticatedApp()).delete("/animals/" + animalId + "/photo");

    expect(response.status).toBe(404);
    expect(mocks.animalUpdate).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("clears the photo reference and deletes the stored object", async () => {
    mocks.animalFindFirst.mockResolvedValue({ id: animalId, photoKey: "animal-photos/current-photo.jpg" });

    const response = await request(authenticatedApp()).delete("/animals/" + animalId + "/photo");

    expect(response.status).toBe(204);
    expect(mocks.animalUpdate).toHaveBeenCalledWith({
      where: { id: animalId },
      data: { photoKey: null },
    });
    expect(mocks.deleteObject).toHaveBeenCalledWith("animal-photos/current-photo.jpg");
  });
});
