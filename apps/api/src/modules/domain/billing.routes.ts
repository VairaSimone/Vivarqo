import { Router } from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

type StripeObject = Record<string, unknown> & { id?: string; object?: string; metadata?: Record<string, unknown> };
type StripeEvent = { id: string; type: string; data: { object: StripeObject } };
function routeId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid subscription id");
  return id;
}
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}
export interface BillingRouterOptions {
  secretKey?: string;
  webhookSecret?: string;
  priceId?: string;
  appOrigin?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}
function configuredStripe(options: BillingRouterOptions): string {
  const key = options.secretKey ?? env.STRIPE_SECRET_KEY;
  if (!key) throw new AppError(503, "BILLING_NOT_CONFIGURED", "Subscription management is not configured");
  return key;
}
async function stripeRequest(path: string, form: URLSearchParams, idempotencyKey: string, options: BillingRouterOptions): Promise<Record<string, unknown>> {
  const key = configuredStripe(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(503, "BILLING_PROVIDER_UNAVAILABLE", "The payment provider is temporarily unavailable");
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const stripeError = typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>).type : undefined;
    throw new AppError(502, "BILLING_PROVIDER_ERROR", "The payment provider could not complete the request", { providerErrorType: typeof stripeError === "string" ? stripeError : null });
  }
  return payload;
}
function stringId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "id" in value && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}
function timestamp(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}
function normalizedStatus(value: unknown): "active" | "trialing" | "past_due" | "incomplete" | "incomplete_expired" | "canceled" | "unpaid" | "paused" {
  const allowed = ["active", "trialing", "past_due", "incomplete", "incomplete_expired", "canceled", "unpaid", "paused"];
  return typeof value === "string" && allowed.includes(value) ? value as ReturnType<typeof normalizedStatus> : "incomplete";
}
function verifyStripeSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string | undefined, nowMs = Date.now()): boolean {
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestampPart = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter((value): value is string => Boolean(value));
  const seconds = Number(timestampPart);
  if (!timestampPart || !Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > 300 || signatures.length === 0) return false;
  const expected = createHmac("sha256", secret).update(`${timestampPart}.`).update(rawBody).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expectedBytes.length && timingSafeEqual(candidate, expectedBytes);
  });
}

type BillingTransaction = Pick<typeof prisma, "subscription" | "stripeWebhookEvent">;
async function syncStripeEvent(tx: BillingTransaction, event: StripeEvent, priceId: string | undefined): Promise<void> {
  const object = event.data.object;
  const eventType = event.type;

  if (eventType.startsWith("customer.subscription.")) {
    const stripeSubscriptionId = stringId(object.id);
    const customerId = stringId(object.customer);
    if (!stripeSubscriptionId || !customerId) return;
    let userId = typeof object.metadata?.user_id === "string" ? object.metadata.user_id : null;
    if (userId && !z.string().uuid().safeParse(userId).success) userId = null;
    if (!userId) {
      const current = await tx.subscription.findFirst({ where: { stripeCustomerId: customerId }, select: { userId: true } });
      userId = current?.userId ?? null;
    }
    if (!userId) return;
    const price = object.items && typeof object.items === "object" && "data" in object.items && Array.isArray((object.items as { data?: unknown }).data)
      ? ((object.items as { data: Array<Record<string, unknown>> }).data[0]?.price as Record<string, unknown> | undefined)?.id
      : undefined;
    const data = {
      stripeCustomerId: customerId,
      stripeSubscriptionId,
      stripePriceId: typeof price === "string" ? price : priceId ?? null,
      status: eventType === "customer.subscription.deleted" ? "canceled" : normalizedStatus(object.status),
      currentPeriodStart: timestamp(object.current_period_start),
      currentPeriodEnd: timestamp(object.current_period_end),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
    };
    await tx.subscription.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return;
  }

  if (eventType === "checkout.session.completed") {
    const userRaw = typeof object.client_reference_id === "string" ? object.client_reference_id :
      typeof object.metadata?.user_id === "string" ? object.metadata.user_id : null;
    if (!userRaw || !z.string().uuid().safeParse(userRaw).success) return;
    const customerId = stringId(object.customer);
    const subscriptionId = stringId(object.subscription);
    if (!customerId || !subscriptionId) return;
    const data = {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId ?? null,
      status: normalizedStatus(object.payment_status === "paid" ? "active" : "incomplete"),
    };
    await tx.subscription.upsert({ where: { userId: userRaw }, create: { userId: userRaw, ...data }, update: data });
    return;
  }

  if (eventType === "invoice.payment_failed") {
    const customerId = stringId(object.customer);
    if (customerId) await tx.subscription.updateMany({ where: { stripeCustomerId: customerId }, data: { status: "past_due" } });
    return;
  }

  if (eventType === "invoice.paid") {
    const customerId = stringId(object.customer);
    if (customerId) await tx.subscription.updateMany({
      where: { stripeCustomerId: customerId, status: "past_due" },
      data: { status: "active" },
    });
  }
}

export function createBillingRouter(options: BillingRouterOptions = {}) {
  const router = Router();
  const secretKey = options.secretKey ?? env.STRIPE_SECRET_KEY;
  const webhookSecret = options.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
  const priceId = options.priceId ?? env.STRIPE_PRICE_ID;
  const appOrigin = options.appOrigin ?? env.APP_ORIGIN;

  router.post("/billing/checkout", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    if (!priceId) throw new AppError(503, "BILLING_NOT_CONFIGURED", "A subscription price has not been configured");
    const current = await prisma.subscription.findUnique({ where: { userId: auth.userId } });
    if (current && ["active", "trialing"].includes(current.status)) {
      throw new AppError(409, "SUBSCRIPTION_ALREADY_ACTIVE", "This account already has an active subscription");
    }
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("success_url", `${appOrigin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${appOrigin}/billing?checkout=cancelled`);
    form.set("client_reference_id", auth.userId);
    form.set("customer_email", auth.email);
    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");
    form.set("metadata[user_id]", auth.userId);
    form.set("subscription_data[metadata][user_id]", auth.userId);
    const session = await stripeRequest("checkout/sessions", form, `vivarqo-checkout-${auth.userId}-${randomUUID()}`, options);
    if (typeof session.url !== "string") throw new AppError(502, "BILLING_PROVIDER_ERROR", "The payment provider returned no checkout URL");
    res.status(200).json({ url: session.url, sessionId: session.id ?? null });
  });

  router.post("/billing/portal", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const subscription = await prisma.subscription.findUnique({ where: { userId: auth.userId } });
    if (!subscription?.stripeCustomerId) throw new AppError(409, "BILLING_CUSTOMER_MISSING", "No billing customer is associated with this account");
    const form = new URLSearchParams();
    form.set("customer", subscription.stripeCustomerId);
    form.set("return_url", `${appOrigin}/billing`);
    const portal = await stripeRequest("billing_portal/sessions", form, `vivarqo-portal-${auth.userId}-${randomUUID()}`, options);
    if (typeof portal.url !== "string") throw new AppError(502, "BILLING_PROVIDER_ERROR", "The payment provider returned no portal URL");
    res.status(200).json({ url: portal.url });
  });

  router.get("/billing/subscription", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const subscription = await prisma.subscription.findUnique({
      where: { userId: auth.userId },
      select: { status: true, stripePriceId: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true, updatedAt: true },
    });
    res.status(200).json({
      configured: Boolean(secretKey && priceId && webhookSecret),
      subscription,
      entitlements: {
        paidSubscription: Boolean(subscription && ["active", "trialing"].includes(subscription.status)),
      },
    });
  });

  router.post("/webhooks/stripe", async (req, res) => {
    if (!webhookSecret) throw new AppError(503, "BILLING_WEBHOOK_NOT_CONFIGURED", "Payment webhook verification is not configured");
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, "WEBHOOK_BODY_REQUIRED", "A raw Stripe webhook payload is required");
    if (!verifyStripeSignature(req.body, req.get("stripe-signature"), webhookSecret, options.now?.() ?? Date.now())) throw new AppError(400, "WEBHOOK_SIGNATURE_INVALID", "Stripe webhook signature is invalid");
    let event: StripeEvent;
    try {
      event = JSON.parse(req.body.toString("utf8")) as StripeEvent;
    } catch {
      throw new AppError(400, "WEBHOOK_BODY_INVALID", "Stripe webhook payload is invalid JSON");
    }
    if (!event.id || typeof event.type !== "string" || !event.data || (typeof event.data.object !== "object" || event.data.object === null)) {
      throw new AppError(400, "WEBHOOK_BODY_INVALID", "Stripe webhook payload is missing required fields");
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.stripeWebhookEvent.create({
          data: { stripeEventId: event.id, eventType: event.type, result: "pending" },
        });
        await syncStripeEvent(tx, event, priceId);
        await tx.stripeWebhookEvent.update({
          where: { stripeEventId: event.id },
          data: { result: "processed", processedAt: new Date() },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const previous = await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
        if (previous?.result === "processed" || previous?.result === "ignored") {
          res.status(200).json({ received: true, duplicate: true });
          return;
        }
      }
      throw error;
    }
    res.status(200).json({ received: true });
  });

  return router;
}
