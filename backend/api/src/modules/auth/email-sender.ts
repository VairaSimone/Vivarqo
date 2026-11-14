import { env } from "../../config/env.js";

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSender {
  send(message: TransactionalEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("Transactional email delivery failed");
    this.name = "EmailDeliveryError";
  }
}

interface ProviderConfig {
  apiKey?: string;
  from?: string;
}

async function postTransactionalEmail(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new EmailDeliveryError();
  }

  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new EmailDeliveryError();
}

export function createBrevoEmailSender(config: ProviderConfig = {
  apiKey: env.BREVO_API_KEY,
  from: env.EMAIL_FROM,
}): EmailSender {
  return {
    async send(message) {
      if (!config.apiKey || !config.from) throw new EmailDeliveryError();
      await postTransactionalEmail(
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": config.apiKey, accept: "application/json" },
        {
          sender: { email: config.from },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
        },
      );
    },
  };
}

export function createResendEmailSender(config: ProviderConfig = {
  apiKey: env.RESEND_API_KEY,
  from: env.EMAIL_FROM,
}): EmailSender {
  return {
    async send(message) {
      if (!config.apiKey || !config.from) throw new EmailDeliveryError();
      await postTransactionalEmail(
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${config.apiKey}` },
        { from: config.from, to: [message.to], subject: message.subject, html: message.html },
      );
    },
  };
}

export function createConfiguredEmailSender(): EmailSender {
  return env.EMAIL_PROVIDER === "brevo"
    ? createBrevoEmailSender()
    : createResendEmailSender();
}
