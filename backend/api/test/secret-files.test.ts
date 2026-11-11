import { describe, expect, it, vi } from "vitest";
import { resolveSecretEnvironment } from "../src/config/secret-files.js";

describe("file-backed runtime secrets", () => {
  it("loads secret values from read-only secret files without retaining *_FILE paths", () => {
    const read = vi.fn((path: string) => {
      if (path === "/run/secrets/csrf") return "a-random-csrf-secret-with-more-than-32-bytes\n";
      throw new Error("not found");
    });
    const resolved = resolveSecretEnvironment({
      NODE_ENV: "production",
      CSRF_SECRET_FILE: "/run/secrets/csrf",
    }, read);
    expect(resolved.CSRF_SECRET).toBe("a-random-csrf-secret-with-more-than-32-bytes");
    expect(resolved.CSRF_SECRET_FILE).toBeUndefined();
    expect(read).toHaveBeenCalledOnce();
  });

  it("builds a PostgreSQL URL from a separately mounted password file", () => {
    const resolved = resolveSecretEnvironment({
      DATABASE_HOST: "postgres", DATABASE_PORT: "5432",
      DATABASE_NAME: "vivarqo", DATABASE_USER: "vivarqo_app",
      DATABASE_PASSWORD_FILE: "/run/secrets/postgres_app_password",
    }, (path) => {
      expect(path).toBe("/run/secrets/postgres_app_password");
      return "p@ss:/? #word\n";
    });
    const url = new URL(resolved.DATABASE_URL!);
    expect(url.protocol).toBe("postgresql:");
    expect(url.hostname).toBe("postgres");
    expect(url.port).toBe("5432");
    expect(url.username).toBe("vivarqo_app");
    expect(decodeURIComponent(url.password)).toBe("p@ss:/? #word");
    expect(url.pathname).toBe("/vivarqo");
    expect(url.searchParams.get("schema")).toBe("public");
    expect(resolved.DATABASE_PASSWORD_FILE).toBeUndefined();
    expect(resolved.DATABASE_PASSWORD).toBeUndefined();
  });

  it("rejects duplicate direct and file-backed secret configuration", () => {
    expect(() => resolveSecretEnvironment({
      CSRF_SECRET: "direct-secret", CSRF_SECRET_FILE: "/run/secrets/csrf",
    }, () => "file-secret")).toThrow(/either CSRF_SECRET or CSRF_SECRET_FILE/);
  });

  it("rejects missing or empty secret files without exposing paths or contents", () => {
    expect(() => resolveSecretEnvironment({
      RESEND_API_KEY_FILE: "/run/secrets/resend",
    }, () => "  \n")).toThrow(/empty/);
    expect(() => resolveSecretEnvironment({
      STRIPE_SECRET_KEY_FILE: "/run/secrets/stripe",
    }, () => { throw new Error("secret path and contents must not leak"); }))
      .toThrow(/Unable to read.*STRIPE_SECRET_KEY_FILE/);
  });

  it("rejects ambiguous database URL and password-file configuration", () => {
    expect(() => resolveSecretEnvironment({
      DATABASE_URL: "postgresql://user:password@postgres/vivarqo",
      DATABASE_PASSWORD_FILE: "/run/secrets/postgres_app_password",
      DATABASE_HOST: "postgres", DATABASE_USER: "vivarqo_app", DATABASE_NAME: "vivarqo",
    }, () => "password")).toThrow(/DATABASE_PASSWORD_FILE or DATABASE_URL/);
  });

  it("validates database connection parameters before creating the URL", () => {
    expect(() => resolveSecretEnvironment({
      DATABASE_HOST: "postgres", DATABASE_PORT: "70000",
      DATABASE_NAME: "vivarqo", DATABASE_USER: "vivarqo_app",
      DATABASE_PASSWORD_FILE: "/run/secrets/postgres_app_password",
    }, () => "password")).toThrow(/DATABASE_PORT/);
  });
});
