import { createECDH } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createVapidAuthorization,
  encryptWebPushPayload,
  isSupportedPushEndpoint,
  sendWebPush,
  type VapidCredentials,
} from "../src/modules/domain/web-push.js";

function keyPair() {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return {
    publicKey: curve.getPublicKey(undefined, "uncompressed"),
    privateKey: curve.getPrivateKey(),
  };
}

describe("Web Push cryptographic delivery", () => {
  it("creates a VAPID ES256 JWT with the correct audience, expiry and subject", () => {
    const vapid = keyPair();
    const credentials: VapidCredentials = {
      publicKey: vapid.publicKey.toString("base64url"),
      privateKey: vapid.privateKey.toString("base64url"),
      subject: "mailto:push@example.test",
    };

    const header = createVapidAuthorization("https://fcm.googleapis.com/wp/test", credentials, 1_800_000_000);
    expect(header.startsWith("vapid t=")).toBe(true);
    const token = header.match(/t=([^,]+)/)?.[1];
    expect(token).toBeTruthy();
    const [jwtHeader, jwtPayload, jwtSignature] = token!.split(".");
    expect(JSON.parse(Buffer.from(jwtHeader!, "base64url").toString("utf8"))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(jwtPayload!, "base64url").toString("utf8"))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_800_043_200,
      sub: "mailto:push@example.test",
    });
    expect(Buffer.from(jwtSignature!, "base64url")).toHaveLength(64);
  });

  it("encrypts a payload into an aes128gcm record for a browser subscription", () => {
    const browser = keyPair();
    const encrypted = encryptWebPushPayload(
      Buffer.from(JSON.stringify({ title: "Vivarqo", body: "Test" }), "utf8"),
      browser.publicKey,
      Buffer.alloc(16, 7),
    );

    expect(encrypted.body.subarray(0, 16)).toHaveLength(16);
    expect(encrypted.body.readUInt32BE(16)).toBe(4096);
    expect(encrypted.body.readUInt8(20)).toBe(65);
    expect(encrypted.serverPublicKey[0]).toBe(4);
    expect(encrypted.body.subarray(21, 86)).toEqual(encrypted.serverPublicKey);
    expect(encrypted.body.length).toBeGreaterThan(21 + 65);
  });

  it("sends encrypted bytes to an approved push service without making a real network request", async () => {
    const vapid = keyPair();
    const browser = keyPair();
    const credentials: VapidCredentials = {
      publicKey: vapid.publicKey.toString("base64url"),
      privateKey: vapid.privateKey.toString("base64url"),
      subject: "https://vivarqo.example.test",
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Encoding"]).toBe("aes128gcm");
      expect((init?.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
      expect(init?.body).toBeInstanceOf(Buffer);
      return new Response(null, { status: 201 });
    });
    const response = await sendWebPush({
      endpoint: "https://fcm.googleapis.com/wp/subscription-id",
      p256dh: browser.publicKey.toString("base64url"),
      authSecret: Buffer.alloc(16, 4).toString("base64url"),
    }, { title: "Test", body: "Body", url: "/settings/notifications", category: "system" }, credentials, fetchImpl as typeof fetch);
    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks arbitrary HTTPS hosts to reduce SSRF risk", async () => {
    expect(isSupportedPushEndpoint("https://fcm.googleapis.com/wp/x")).toBe(true);
    expect(isSupportedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isSupportedPushEndpoint("https://127.0.0.1/admin")).toBe(false);
    expect(isSupportedPushEndpoint("https://attacker.example.test/push")).toBe(false);
    await expect(sendWebPush({
      endpoint: "https://attacker.example.test/push",
      p256dh: Buffer.alloc(65).toString("base64url"),
      authSecret: Buffer.alloc(16).toString("base64url"),
    }, { title: "Test", body: "Blocked" }, {
      publicKey: Buffer.alloc(65, 1).toString("base64url"),
      privateKey: Buffer.alloc(32, 2).toString("base64url"),
      subject: "mailto:push@example.test",
    }, vi.fn() as typeof fetch)).rejects.toMatchObject({ code: "PUSH_ENDPOINT_UNSUPPORTED" });
  });
});
