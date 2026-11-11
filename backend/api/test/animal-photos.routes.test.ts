import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAnimalPhotoRouter } from "../src/modules/domain/animal-photos.routes.js";

const app = express();
app.use(createAnimalPhotoRouter());

describe("animal photo route access control", () => {
  const animalId = "9a8c4514-8958-4e0b-a5f0-b68c2c7a2c3d";

  it("requires an authenticated owner before serving a private image", async () => {
    const response = await request(app).get("/animals/" + animalId + "/photo");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("requires an authenticated owner before accepting an image upload", async () => {
    const response = await request(app)
      .post("/animals/" + animalId + "/photo")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("requires an authenticated owner before deleting a photo", async () => {
    const response = await request(app).delete("/animals/" + animalId + "/photo");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects malformed public share slugs without looking up storage objects", async () => {
    const response = await request(app).get("/public/animals/not-a-valid-share/photo");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("PUBLIC_PAGE_NOT_FOUND");
  });
});
