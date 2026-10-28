import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { logger } from "../src/logger.js";

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
      message: "Servizio temporaneamente non disponibile",
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain("private connection details");
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("honors Accept-Language for unauthenticated requests", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .get("/api/v1/not-implemented")
      .set("Accept-Language", "en-GB,en;q=0.9");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Route not found");
  });

  it("returns a standardized 404 response for unimplemented routes", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .get("/api/v1/not-implemented");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: "NOT_FOUND",
      message: "Percorso non trovato",
      details: null,
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("does not log raw paths that can contain bearer links or user identifiers", async () => {
    const rawSecret = "share-secret-should-not-be-logged-123";
    const warn = vi.spyOn(logger, "warn");
    try {
      await request(createApp({ checkDatabase: async () => undefined }))
        .get("/unmatched/" + rawSecret)
        .expect(404);

      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(rawSecret);
      expect(JSON.stringify(warn.mock.calls)).toContain("unmatched");
    } finally {
      warn.mockRestore();
    }
  });

  it("normalizes malformed JSON into a safe 400 response", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .post("/api/v1/example")
      .set("content-type", "application/json")
      .send('{"invalid":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "INVALID_JSON",
      message: "Il corpo della richiesta JSON non è valido",
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
      message: "La verifica CSRF non è riuscita",
    });
  });

  it("allows the document note header through browser CORS preflight", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .options("/api/v1/documents")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token,x-document-note");

    expect(response.status).toBe(204);
    expect(String(response.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain("x-document-note");
  });

  it("sets security headers and does not expose Express", async () => {
    const response = await request(createApp({ checkDatabase: async () => undefined }))
      .get("/healthz");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
