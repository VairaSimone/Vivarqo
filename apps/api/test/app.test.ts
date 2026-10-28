import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("API infrastructure", () => {
  it("reports liveness without requiring PostgreSQL", async () => {
    const checkDatabase = vi.fn(async () => {
      throw new Error("database should not be queried by /healthz");
    });
    const response = await request(createApp({ checkDatabase })).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(checkDatabase).not.toHaveBeenCalled();
    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
  });

  it("reports readiness when the database check succeeds", async () => {
    const checkDatabase = vi.fn(async () => undefined);
    const response = await request(createApp({ checkDatabase })).get("/readyz");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ready" });
    expect(checkDatabase).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 503 when the database is unavailable", async () => {
    const checkDatabase = vi.fn(async () => {
      throw new Error("private connection details must not be returned");
    });
    const response = await request(createApp({ checkDatabase })).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable",
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain("private connection details");
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("returns a standardized 404 response for unimplemented routes", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .get("/api/v1/not-implemented");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: "NOT_FOUND",
      message: "Route not found",
      details: null,
    });
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("normalizes malformed JSON into a safe 400 response", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .post("/api/v1/example")
      .set("content-type", "application/json")
      .send('{"invalid":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "INVALID_JSON",
      message: "Malformed JSON request body",
      details: null,
    });
  });

  it("rejects mutating API requests without a valid CSRF token", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .post("/api/v1/auth/logout")
      .set("Origin", "http://localhost:5173")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "CSRF_INVALID",
      message: "CSRF validation failed",
    });
  });

  it("sets security headers and does not expose Express", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .get("/healthz");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
