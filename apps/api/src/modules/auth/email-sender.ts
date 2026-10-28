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

export function createResendEmailSender(): EmailSender {
  return {
    async send(message) {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
        throw new EmailDeliveryError();
      }

      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            html: message.html,
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
      } catch {
        throw new EmailDeliveryError();
      }

      if (!response.ok) {
        // Provider response bodies are deliberately not logged or returned.
        throw new EmailDeliveryError();
      }
    },
  };
}
