# Vivarqo subscription plans

## Public pricing

- Free: €0.
- Premium monthly: €4.99, recurring every month.
- Premium annual: €49.99, recurring every year.

The free plan keeps core animal-care, feeding, shedding, weight, calendar, reminders, reproduction, inventory, finance, import/export and QR/public-share workflows available. Its initial quotas are 15 animals, 30 active documents and 512 MiB of private document storage. Premium removes these three quotas.

Quotas are enforced by the API, not by the frontend. Set `BILLING_FREE_MAX_ANIMALS`, `BILLING_FREE_MAX_DOCUMENTS` and `BILLING_FREE_MAX_STORAGE_BYTES` to adjust them. A value of zero means unlimited. Keep `BILLING_ACCESS_MODE=unrestricted`: subscription-required mode is a separate global access switch and is not appropriate for the free-first product model.

## Stripe setup

Create a Vivarqo Premium product in the Stripe Dashboard and create two recurring EUR prices:

1. €4.99 with interval `month`.
2. €49.99 with interval `year`.

Copy the resulting Price IDs into the runtime environment:

- `STRIPE_PRICE_MONTHLY_ID=price_...`
- `STRIPE_PRICE_ANNUAL_ID=price_...`

Use Test Mode Price IDs and Test Mode credentials in staging. Use Live Mode IDs and credentials only in production. Never commit Stripe secret keys or webhook signing secrets.

Configure a Stripe webhook pointing to `/api/v1/webhooks/stripe` and subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Configure the Stripe Customer Portal so customers can update payment methods and cancel subscriptions. The application grants Premium only after a verified subscription event supplies a recognized Price ID and a valid paid-through period.

The deployed API validates that both recurring Price IDs are configured. Checkout accepts only `monthly` or `annual`; it never accepts an arbitrary client-supplied Stripe Price ID.
