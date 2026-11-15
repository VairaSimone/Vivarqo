import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("animal management API access boundaries", () => {
  const app = createApp({ checkDatabase: async () => undefined });

  it("mounts the hierarchical location endpoint behind authentication", async () => {
    const response = await request(app).get("/api/v1/animals/locations");
    expect(response.status).toBe(401);
  });

  it("protects animal location history and transfer records", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const history = await request(app).get("/api/v1/animals/" + id + "/location-history");
    const transfers = await request(app).get("/api/v1/animals/" + id + "/transfers");
    expect(history.status).toBe(401);
    expect(transfers.status).toBe(401);
  });

  it("protects per-animal feeding analytics behind authentication", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await request(app).get("/api/v1/animals/" + id + "/feeding-summary");
    expect(response.status).toBe(401);
  });

  it("does not expose internal QR resolution without an authenticated session", async () => {
    const token = "A".repeat(32);
    const response = await request(app).get("/api/v1/animals/qr/" + token);
    expect(response.status).toBe(401);
  });
});
