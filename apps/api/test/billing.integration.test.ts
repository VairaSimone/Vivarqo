import { createHmac, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";
const webhookSecret = "whsec_vivarqo_test_secret";
const fakeStripeSecret = "sk_test_vivarqo_mock";
const generatedEventIds: string[] = [];
const userIds: string[] = [];

function signature(rawBody: Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", secret).update(String(timestamp) + ".").update(rawBody).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe.skipIf(!enabled)("Stripe billing lifecycle with deterministic Test Mode contracts", () => {
  let app: Express;
  const stripeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith("https://api.stripe.com/v1/")).toBe(true);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${fakeStripeSecret}`);
    const result = url.endsWith("/checkout/sessions")
      ? { id: "cs_test_vivarqo", url: "https://checkout.stripe.com/c/pay/cs_test_vivarqo" }
      : { id: "bps_test_vivarqo", url: "https://billing.stripe.com/p/session/bps_test_vivarqo" };
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  });

  beforeAll(() => {
    app = createApp({
      checkDatabase: async () => undefined,
      billing: {
        secretKey: fakeStripeSecret,
        webhookSecret,
        priceId: "price_test_vivarqo",
        appOrigin: origin,
        fetchImpl: stripeFetch as typeof fetch,
      },
    });
  });

  afterAll(async () => {
    await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: { in: generatedEventIds } } });
    if (userIds.length) {
      await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function account() {
    const email = `billing-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: "Stripe Integration",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password }).expect(200);
    return { userId: user.id, agent, csrf };
  }

  function sendEvent(agent: ReturnType<typeof request.agent>, event: Record<string, unknown>) {
    const eventId = String(event.id);
    generatedEventIds.push(eventId);
    const body = Buffer.from(JSON.stringify(event), "utf8");
    return agent.post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signature(body, webhookSecret))
      .send(body.toString("utf8"));
  }

  it("creates checkout and portal sessions, verifies signed events, syncs subscription states and deduplicates retries", async () => {
    const owner = await account();
    const checkout = await owner.agent.post("/api/v1/billing/checkout")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    expect(checkout.body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_vivarqo");

    const checkoutEvent = {
      id: `evt_vivarqo_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_vivarqo",
        object: "checkout.session",
        client_reference_id: owner.userId,
        customer: "cus_test_vivarqo",
        subscription: "sub_test_vivarqo",
        payment_status: "paid",
        metadata: { user_id: owner.userId },
      } },
    };
    const completion = await sendEvent(owner.agent, checkoutEvent);
    expect(completion.status, `Webhook returned ${completion.status}: ${completion.text}`).toBe(200);
    expect(completion.body.received).toBe(true);
    const subscription = await prisma.subscription.findUnique({ where: { userId: owner.userId } });
    expect(subscription).toMatchObject({ stripeCustomerId: "cus_test_vivarqo", stripeSubscriptionId: "sub_test_vivarqo", status: "active" });

    const portal = await owner.agent.post("/api/v1/billing/portal")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).send({}).expect(200);
    expect(portal.body.url).toBe("https://billing.stripe.com/p/session/bps_test_vivarqo");

    const baseTime = Math.floor(Date.now() / 1000);
    const updatedEvent = {
      id: `evt_vivarqo_${randomUUID()}`,
      type: "customer.subscription.updated",
      data: { object: {
        id: "sub_test_vivarqo",
        object: "subscription",
        customer: "cus_test_vivarqo",
        metadata: { user_id: owner.userId },
        status: "active",
        current_period_start: baseTime,
        current_period_end: baseTime + 2_592_000,
        cancel_at_period_end: true,
        items: { data: [{ price: { id: "price_test_vivarqo" } }] },
      } },
    };
    await sendEvent(owner.agent, updatedEvent).expect(200);
    const period = await prisma.subscription.findUniqueOrThrow({ where: { userId: owner.userId } });
    expect(period.stripePriceId).toBe("price_test_vivarqo");
    expect(period.cancelAtPeriodEnd).toBe(true);
    expect(period.currentPeriodEnd?.getTime()).toBe((baseTime + 2_592_000) * 1000);

    const failedEvent = {
      id: `evt_vivarqo_${randomUUID()}`, type: "invoice.payment_failed",
      data: { object: { id: "in_test_failed", customer: "cus_test_vivarqo" } },
    };
    await sendEvent(owner.agent, failedEvent).expect(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: owner.userId } })).status).toBe("past_due");

    const paidEvent = {
      id: `evt_vivarqo_${randomUUID()}`, type: "invoice.paid",
      data: { object: { id: "in_test_paid", customer: "cus_test_vivarqo" } },
    };
    await sendEvent(owner.agent, paidEvent).expect(200);
    const paidAgain = await prisma.subscription.findUniqueOrThrow({ where: { userId: owner.userId } });
    expect(paidAgain.status).toBe("active");
    expect(paidAgain.cancelAtPeriodEnd).toBe(true);

    const duplicate = await sendEvent(owner.agent, updatedEvent).expect(200);
    expect(duplicate.body).toMatchObject({ received: true, duplicate: true });
    const billingState = await owner.agent.get("/api/v1/billing/subscription").expect(200);
    expect(billingState.body.entitlements.paidSubscription).toBe(true);
    expect(stripeFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects expired and invalid webhook signatures without persisting the event", async () => {
    const owner = await account();
    const event = {
      id: `evt_vivarqo_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", client_reference_id: owner.userId, customer: "cus_test", subscription: "sub_test", payment_status: "paid" } },
    };
    const body = Buffer.from(JSON.stringify(event));
    await owner.agent.post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signature(body, webhookSecret, Math.floor(Date.now() / 1000) - 600))
      .send(body).expect(400);
    await owner.agent.post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signature(body, "wrong_secret"))
      .send(body).expect(400);
    expect(await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } })).toBeNull();
  });
});
