import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrevoEmailSender, EmailDeliveryError } from "../src/modules/auth/email-sender.js";

describe("Brevo transactional email sender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends HTML transactional email through the Brevo API using the API key header", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const sender = createBrevoEmailSender({
      apiKey: "test-brevo-api-key",
      from: "noreply@example.test",
    });
    await sender.send({
      to: "user@example.test",
      subject: "Verifica il tuo account",
      html: "<p>Apri il link</p>",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({
      "api-key": "test-brevo-api-key",
      accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(options.body))).toEqual({
      sender: { email: "noreply@example.test" },
      to: [{ email: "user@example.test" }],
      subject: "Verifica il tuo account",
      htmlContent: "<p>Apri il link</p>",
    });
  });

  it("does not expose provider response details when Brevo rejects a request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive provider detail", { status: 401 })));
    const sender = createBrevoEmailSender({ apiKey: "invalid-key", from: "noreply@example.test" });

    await expect(sender.send({
      to: "user@example.test",
      subject: "Test",
      html: "<p>Test</p>",
    })).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("fails closed when credentials or sender are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sender = createBrevoEmailSender({ apiKey: undefined, from: "noreply@example.test" });

    await expect(sender.send({
      to: "user@example.test",
      subject: "Test",
      html: "<p>Test</p>",
    })).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
