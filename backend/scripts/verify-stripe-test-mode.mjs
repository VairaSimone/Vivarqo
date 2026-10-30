#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const secret = process.env.STRIPE_SECRET_KEY ?? "";
const priceId = process.env.STRIPE_PRICE_ID ?? "";
const appOrigin = process.env.APP_ORIGIN ?? "";
const email = process.env.STRIPE_TEST_EMAIL ?? "";
const userId = process.env.STRIPE_TEST_USER_ID ?? "";
if (!secret.startsWith("sk_test_")) throw new Error("Refusing to run: STRIPE_SECRET_KEY must start with sk_test_.");
if (!priceId.startsWith("price_") || !email || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("Set STRIPE_PRICE_ID, STRIPE_TEST_EMAIL and a UUID test account in STRIPE_TEST_USER_ID.");
}
const origin = new URL(appOrigin);
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
  throw new Error("APP_ORIGIN must be a valid application origin.");
}

async function stripe(path, method = "GET", form) {
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + secret,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      "Idempotency-Key": "vivarqo-live-test-" + randomUUID(),
    },
    ...(form ? { body: form } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Stripe Test Mode request failed (" + response.status + ", " + (data?.error?.type ?? "unknown") + ").");
  return data;
}

const price = await stripe("prices/" + encodeURIComponent(priceId));
if (price.active !== true || price.type !== "recurring") throw new Error("Stripe price must be active and recurring.");
const form = new URLSearchParams();
form.set("mode", "subscription");
form.set("success_url", new URL("/billing?stripe_test=success&session_id={CHECKOUT_SESSION_ID}", origin).toString());
form.set("cancel_url", new URL("/billing?stripe_test=cancelled", origin).toString());
form.set("client_reference_id", userId);
form.set("customer_email", email);
form.set("line_items[0][price]", priceId);
form.set("line_items[0][quantity]", "1");
form.set("metadata[user_id]", userId);
form.set("subscription_data[metadata][user_id]", userId);
const checkout = await stripe("checkout/sessions", "POST", form);
if (typeof checkout.url !== "string" || !checkout.url.startsWith("https://checkout.stripe.com/")) {
  throw new Error("Stripe did not return hosted Test Mode Checkout.");
}
process.stdout.write("Test Mode Checkout session created: " + checkout.id + "\n");
process.stdout.write("Complete the hosted flow with test payment details: " + checkout.url + "\n");
const customerId = process.env.STRIPE_TEST_CUSTOMER_ID;
if (customerId) {
  const portal = await stripe("billing_portal/sessions", "POST", new URLSearchParams({
    customer: customerId, return_url: new URL("/billing", origin).toString(),
  }));
  process.stdout.write("Test Mode Customer Portal: " + portal.url + "\n");
} else {
  process.stdout.write("Portal check skipped; after Checkout set STRIPE_TEST_CUSTOMER_ID=cus_... and run again.\n");
}
