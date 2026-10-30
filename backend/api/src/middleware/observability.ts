import { randomBytes, timingSafeEqual } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Request, RequestHandler, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

type HttpMetric = {
  method: string;
  route: string;
  status: number;
  count: number;
  totalSeconds: number;
  buckets: number[];
};

const HISTOGRAM_BOUNDS = [0.05, 0.1, 0.3, 1, 3, 10] as const;
const httpMetrics = new Map<string, HttpMetric>();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let activeRequests = 0;
let sentryEventsThisMinute = 0;
let sentryWindowStartedAt = Date.now();

function label(value: string): string {
  return value.replace(/[^a-zA-Z0-9_./:-]/g, "_").slice(0, 120) || "unknown";
}
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
function metricKey(method: string, route: string, status: number): string {
  return [method, route, status].join("|");
}

export const requestMetrics: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  activeRequests += 1;
  res.once("finish", () => {
    activeRequests = Math.max(0, activeRequests - 1);
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const routePath = req.route?.path;
    const route = label(req.baseUrl + (typeof routePath === "string" ? routePath : routePath ? "[route]" : "[unmatched]"));
    const method = label(req.method);
    const status = res.statusCode;
    const key = metricKey(method, route, status);
    const metric = httpMetrics.get(key) ?? {
      method, route, status, count: 0, totalSeconds: 0,
      buckets: HISTOGRAM_BOUNDS.map(() => 0),
    };
    metric.count += 1;
    metric.totalSeconds += elapsedSeconds;
    HISTOGRAM_BOUNDS.forEach((bound, index) => {
      if (elapsedSeconds <= bound) metric.buckets[index] = (metric.buckets[index] ?? 0) + 1;
    });
    httpMetrics.set(key, metric);
  });
  next();
};

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function queueMetrics(): Promise<string[]> {
  const [jobRows, workerRows] = await Promise.all([
    prisma.$queryRaw<Array<{ queue: string; status: string; count: bigint }>>`
      SELECT 'imports' AS queue, status::text AS status, count(*)::bigint AS count
      FROM import_jobs GROUP BY status
      UNION ALL
      SELECT 'exports' AS queue, status::text AS status, count(*)::bigint AS count
      FROM export_jobs GROUP BY status
      UNION ALL
      SELECT 'push' AS queue, status::text AS status, count(*)::bigint AS count
      FROM push_delivery_attempts GROUP BY status
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM api_rate_limit_buckets
      WHERE namespace = 'worker-heartbeat' AND reset_at > now()
    `,
  ]);
  const lines = [
    "# HELP vivarqo_jobs Number of jobs by queue and state.",
    "# TYPE vivarqo_jobs gauge",
  ];
  for (const row of jobRows) {
    lines.push(`vivarqo_jobs{queue="${escapeLabel(row.queue)}",status="${escapeLabel(row.status)}"} ${Number(row.count)}`);
  }
  lines.push("# HELP vivarqo_background_workers_live Background worker processes with a fresh PostgreSQL heartbeat.");
  lines.push("# TYPE vivarqo_background_workers_live gauge");
  lines.push(`vivarqo_background_workers_live ${Number(workerRows[0]?.count ?? 0n)}`);
  return lines;
}

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  const expectedToken = env.METRICS_BEARER_TOKEN;
  if (!expectedToken) { res.status(404).end(); return; }
  const authorization = req.get("authorization") ?? "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, expectedToken)) { res.status(404).end(); return; }

  try {
    const memory = process.memoryUsage();
    const lines = [
      "# HELP vivarqo_process_uptime_seconds Process uptime in seconds.",
      "# TYPE vivarqo_process_uptime_seconds gauge",
      `vivarqo_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      "# HELP vivarqo_process_memory_bytes Node.js process memory by type.",
      "# TYPE vivarqo_process_memory_bytes gauge",
      `vivarqo_process_memory_bytes{type="rss"} ${memory.rss}`,
      `vivarqo_process_memory_bytes{type="heap_used"} ${memory.heapUsed}`,
      `vivarqo_process_memory_bytes{type="heap_total"} ${memory.heapTotal}`,
      `vivarqo_process_memory_bytes{type="external"} ${memory.external}`,
      "# HELP vivarqo_http_requests_active Requests currently being processed.",
      "# TYPE vivarqo_http_requests_active gauge",
      `vivarqo_http_requests_active ${activeRequests}`,
      "# HELP vivarqo_node_event_loop_delay_seconds Mean event loop delay in seconds.",
      "# TYPE vivarqo_node_event_loop_delay_seconds gauge",
      `vivarqo_node_event_loop_delay_seconds ${Number.isFinite(eventLoopDelay.mean) ? (eventLoopDelay.mean / 1_000_000_000).toFixed(6) : "0"}`,
      "# HELP vivarqo_http_requests_total Completed HTTP requests.",
      "# TYPE vivarqo_http_requests_total counter",
      "# HELP vivarqo_http_request_duration_seconds HTTP request duration.",
      "# TYPE vivarqo_http_request_duration_seconds histogram",
    ];
    for (const metric of httpMetrics.values()) {
      const labels = `method="${escapeLabel(metric.method)}",route="${escapeLabel(metric.route)}",status="${metric.status}"`;
      lines.push(`vivarqo_http_requests_total{${labels}} ${metric.count}`);
      HISTOGRAM_BOUNDS.forEach((bound, index) => {
        lines.push(`vivarqo_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${metric.buckets[index]}`);
      });
      lines.push(`vivarqo_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`);
      lines.push(`vivarqo_http_request_duration_seconds_sum{${labels}} ${metric.totalSeconds.toFixed(6)}`);
      lines.push(`vivarqo_http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    lines.push(...await queueMetrics());
    res.status(200).setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(lines.join("\n") + "\n");
  } catch {
    res.status(503).setHeader("Cache-Control", "no-store").end();
  }
}

export interface SentryContext {
  requestId?: string;
  route?: string;
  worker?: string;
  code?: string;
}

/** Sends minimal Sentry envelopes; request bodies, query strings, cookies and user data are excluded. */
export function captureException(error: unknown, context: SentryContext = {}): void {
  if (!env.SENTRY_DSN) return;
  const now = Date.now();
  if (now - sentryWindowStartedAt >= 60_000) { sentryWindowStartedAt = now; sentryEventsThisMinute = 0; }
  if (sentryEventsThisMinute >= 30) return;
  sentryEventsThisMinute += 1;

  let dsn: URL;
  try { dsn = new URL(env.SENTRY_DSN); } catch { return; }
  const publicKey = dsn.username;
  const projectId = dsn.pathname.split("/").filter(Boolean).at(-1);
  if (dsn.protocol !== "https:" || !publicKey || !projectId) return;
  const prefix = dsn.pathname.slice(0, dsn.pathname.lastIndexOf("/"));
  const endpoint = new URL(`${prefix}/api/${projectId}/envelope/`, dsn.origin);
  endpoint.searchParams.set("sentry_key", publicKey);
  endpoint.searchParams.set("sentry_version", "7");
  endpoint.searchParams.set("sentry_client", "vivarqo-node/0.1");
  const eventId = randomBytes(16).toString("hex");
  const errorName = error instanceof Error ? error.name.slice(0, 100) : "UnknownError";
  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    environment: env.NODE_ENV,
    fingerprint: ["{{ default }}", errorName, context.code ?? "unhandled"],
    exception: { values: [{ type: errorName, value: context.code ?? "Unhandled application error" }] },
    tags: {
      worker: context.worker ?? "api",
      route: context.route ?? "unknown",
      error_code: context.code ?? "unhandled",
    },
    ...(context.requestId ? { extra: { request_id: context.requestId } } : {}),
  };
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: env.SENTRY_DSN }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope,
    signal: AbortSignal.timeout(2_000),
    redirect: "error",
  }).then(response => response.body?.cancel().catch(() => undefined)).catch(() => undefined);
}
