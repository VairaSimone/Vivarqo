import * as Sentry from "@sentry/node";
import { env } from "./config/env.js";

let initialized = false;

/**
 * Initializes error reporting only when an operator supplies SENTRY_DSN.
 * Request bodies, cookies, authorization data, and query strings are excluded
 * because they may contain account data or one-time authentication tokens.
 */
export function initializeSentry(): void {
  if (initialized || !env.SENTRY_DSN) return;
  initialized = true;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    beforeSend(event) {
      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.headers = {};
        if (event.request.url) {
          try {
            const url = new URL(event.request.url);
            url.search = "";
            url.hash = "";
            event.request.url = url.toString();
          } catch {
            event.request.url = undefined;
          }
        }
      }
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
  });
}

export function installSentryExpressHandler(app: import("express").Express): void {
  if (!env.SENTRY_DSN) return;
  Sentry.setupExpressErrorHandler(app);
}
