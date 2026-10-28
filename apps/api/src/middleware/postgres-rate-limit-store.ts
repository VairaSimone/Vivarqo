import { createHmac } from "node:crypto";
import type { IncrementResponse, Options, Store } from "express-rate-limit";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

/**
 * PostgreSQL-backed fixed-window store for sensitive authentication limits.
 * IP-derived keys are HMACed before persistence; raw addresses never enter this
 * table. A shared database makes limits consistent across API replicas/restarts.
 */
export class PostgresRateLimitStore implements Store {
  private windowMs = 15 * 60 * 1000;

  constructor(private readonly namespace: string) {
    if (!/^[a-z0-9-]{1,80}$/.test(namespace)) {
      throw new Error("Rate-limit namespace must be a short lowercase identifier");
    }
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private hashKey(key: string): string {
    return createHmac("sha256", env.CSRF_SECRET)
      .update(this.namespace)
      .update("\0")
      .update(key)
      .digest("hex");
  }

  async increment(key: string): Promise<IncrementResponse> {
    const keyHash = this.hashKey(key);
    const nextResetAt = new Date(Date.now() + this.windowMs);
    const rows = await prisma.$queryRaw<Array<{ totalHits: number; resetTime: Date }>>`
      INSERT INTO api_rate_limit_buckets (namespace, key_hash, hits, reset_at, updated_at)
      VALUES (${this.namespace}, ${keyHash}, 1, ${nextResetAt}, now())
      ON CONFLICT (namespace, key_hash) DO UPDATE SET
        hits = CASE
          WHEN api_rate_limit_buckets.reset_at <= now() THEN 1
          ELSE api_rate_limit_buckets.hits + 1
        END,
        reset_at = CASE
          WHEN api_rate_limit_buckets.reset_at <= now() THEN EXCLUDED.reset_at
          ELSE api_rate_limit_buckets.reset_at
        END,
        updated_at = now()
      RETURNING hits AS "totalHits", reset_at AS "resetTime"
    `;
    const row = rows[0];
    if (!row) throw new Error("PostgreSQL rate-limit store returned no counter");
    return { totalHits: Number(row.totalHits), resetTime: new Date(row.resetTime) };
  }

  async get(key: string): Promise<IncrementResponse | undefined> {
    const rows = await prisma.$queryRaw<Array<{ totalHits: number; resetTime: Date }>>`
      SELECT hits AS "totalHits", reset_at AS "resetTime"
      FROM api_rate_limit_buckets
      WHERE namespace = ${this.namespace}
        AND key_hash = ${this.hashKey(key)}
        AND reset_at > now()
    `;
    const row = rows[0];
    return row ? { totalHits: Number(row.totalHits), resetTime: new Date(row.resetTime) } : undefined;
  }

  async decrement(key: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE api_rate_limit_buckets
      SET hits = GREATEST(hits - 1, 0), updated_at = now()
      WHERE namespace = ${this.namespace}
        AND key_hash = ${this.hashKey(key)}
        AND reset_at > now()
    `;
  }

  async resetKey(key: string): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM api_rate_limit_buckets
      WHERE namespace = ${this.namespace} AND key_hash = ${this.hashKey(key)}
    `;
  }
}
