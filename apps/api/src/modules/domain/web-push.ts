import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  category?: string;
}
export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  authSecret: string;
}
export interface PushSendResult {
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
  skipped?: "disabled" | "quiet_hours" | "no_subscriptions";
}

function b64url(value: Buffer): string {
  return value.toString("base64url");
}
function decodeKey(value: string, name: string, minBytes: number, maxBytes: number): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", `${name} is invalid`);
  }
  if (decoded.length < minBytes || decoded.length > maxBytes) {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", `${name} is invalid`);
  }
  return decoded;
}
let cachedVapidCredentials: VapidCredentials | undefined;

export function getVapidCredentials(): VapidCredentials {
  // Configuration is immutable for the lifetime of this process. Validate the
  // P-256 keypair once instead of repeating elliptic-curve work for every
  // notification or public-key request.
  if (cachedVapidCredentials) return cachedVapidCredentials;

  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", "Web Push VAPID keys and subject are not configured");
  }
  if (!(subject.startsWith("mailto:") || subject.startsWith("https://"))) {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", "VAPID subject must be a mailto: or HTTPS URL");
  }
  const credentials = { publicKey, privateKey, subject };
  // Validate key format and ensure the private/public pair matches before using it.
  const privateScalar = decodeKey(privateKey, "VAPID_PRIVATE_KEY", 32, 32);
  const publicPoint = decodeKey(publicKey, "VAPID_PUBLIC_KEY", 65, 65);
  if (publicPoint[0] !== 4) throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", "VAPID_PUBLIC_KEY must be an uncompressed P-256 point");
  const curve = createECDH("prime256v1");
  try {
    curve.setPrivateKey(privateScalar);
  } catch {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", "VAPID_PRIVATE_KEY is not a valid P-256 private key");
  }
  const derived = curve.getPublicKey(undefined, "uncompressed");
  if (derived.length !== publicPoint.length || !timingSafeEqual(derived, publicPoint)) {
    throw new AppError(503, "WEB_PUSH_NOT_CONFIGURED", "VAPID public and private keys do not match");
  }
  cachedVapidCredentials = credentials;
  return credentials;
}
export function getVapidPublicKey(): string {
  return getVapidCredentials().publicKey;
}

function hkdfExtract(salt: Buffer, inputKeyMaterial: Buffer): Buffer {
  return createHmac("sha256", salt.length ? salt : Buffer.alloc(32)).update(inputKeyMaterial).digest();
}
function hkdfExpand(pseudorandomKey: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let index = 1; Buffer.concat(blocks).length < length; index += 1) {
    previous = createHmac("sha256", pseudorandomKey).update(previous).update(info).update(Buffer.from([index])).digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}
function buildPrivateKey(publicPoint: Buffer, privateScalar: Buffer) {
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(publicPoint.subarray(1, 33)),
      y: b64url(publicPoint.subarray(33, 65)),
      d: b64url(privateScalar),
    },
    format: "jwk",
  });
}

export function createVapidAuthorization(endpoint: string, credentials: VapidCredentials, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const endpointUrl = new URL(endpoint);
  const publicPoint = decodeKey(credentials.publicKey, "VAPID_PUBLIC_KEY", 65, 65);
  const privateScalar = decodeKey(credentials.privateKey, "VAPID_PRIVATE_KEY", 32, 32);
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(Buffer.from(JSON.stringify({
    aud: endpointUrl.origin,
    exp: nowSeconds + 12 * 60 * 60,
    sub: credentials.subject,
  })));
  const message = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(message), {
    key: buildPrivateKey(publicPoint, privateScalar),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${message}.${b64url(signature)}, k=${credentials.publicKey}`;
}

export function encryptWebPushPayload(payload: Buffer, userPublicKey: Buffer, userAuthSecret: Buffer): { body: Buffer; serverPublicKey: Buffer } {
  if (userPublicKey.length !== 65 || userPublicKey[0] !== 4 || userAuthSecret.length < 16 || userAuthSecret.length > 32) {
    throw new AppError(400, "PUSH_SUBSCRIPTION_INVALID", "Stored Web Push subscription keys are invalid");
  }
  // RFC 8291: a single aes128gcm record, with the 0x02 final-record delimiter.
  const serverCurve = createECDH("prime256v1");
  serverCurve.generateKeys();
  const serverPublicKey = serverCurve.getPublicKey(undefined, "uncompressed");
  const sharedSecret = serverCurve.computeSecret(userPublicKey);
  const authPrk = hkdfExtract(userAuthSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\u0000", "utf8"), userPublicKey, serverPublicKey]);
  const inputKeyMaterial = hkdfExpand(authPrk, keyInfo, 32);
  const salt = randomBytes(16);
  const contentPrk = hkdfExtract(salt, inputKeyMaterial);
  const cek = hkdfExpand(contentPrk, Buffer.from("Content-Encoding: aes128gcm\u0000", "utf8"), 16);
  const nonce = hkdfExpand(contentPrk, Buffer.from("Content-Encoding: nonce\u0000", "utf8"), 12);
  const paddedPayload = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(paddedPayload), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublicKey.length, 20);
  return { body: Buffer.concat([header, serverPublicKey, ciphertext]), serverPublicKey };
}
export function isSupportedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host.endsWith(".push.services.mozilla.com")
      || host === "push.services.mozilla.com"
      || host === "web.push.apple.com"
      || host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function createPushPayload(payload: PushPayload): Buffer {
  const safeUrl = payload.url && payload.url.startsWith("/") && !payload.url.startsWith("//") ? payload.url : "/";
  const data = {
    title: payload.title.slice(0, 160),
    body: payload.body.slice(0, 1000),
    url: safeUrl,
    category: (payload.category ?? "general").slice(0, 30),
  };
  const serialized = Buffer.from(JSON.stringify(data), "utf8");
  if (serialized.length > 3000) throw new AppError(400, "PUSH_PAYLOAD_TOO_LARGE", "Web Push payload cannot exceed 3000 bytes");
  return serialized;
}

export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: PushPayload,
  credentials: VapidCredentials = getVapidCredentials(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!isSupportedPushEndpoint(subscription.endpoint)) {
    throw new AppError(400, "PUSH_ENDPOINT_UNSUPPORTED", "The push provider endpoint is not supported");
  }
  const publicKey = decodeKey(subscription.p256dh, "p256dh", 65, 65);
  const authSecret = decodeKey(subscription.authSecret, "auth", 16, 32);
  const encrypted = encryptWebPushPayload(createPushPayload(payload), publicKey, authSecret);
  // Avoid leaking keys or the provider response body to logs and callers.
  void encrypted.serverPublicKey;
  return fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: createVapidAuthorization(subscription.endpoint, credentials),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "60",
      "Urgency": "normal",
    },
    body: encrypted.body,
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
}

function isWithinQuietHours(now: Date, timezone: string, start: Date | null, end: Date | null): boolean {
  if (!start || !end || start.getTime() === end.getTime()) return false;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [hour, minute] = time.split(":").map(Number);
  const currentMinutes = hour! * 60 + minute!;
  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
  const credentials = getVapidCredentials();
  const [preferences, user, subscriptions] = await Promise.all([
    prisma.notificationPreferences.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.pushSubscription.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, authSecret: true } }),
  ]);
  if (!preferences?.pushEnabled) return { attempted: 0, sent: 0, removed: 0, failed: 0, skipped: "disabled" };
  const categoryEnabled = (preferences.categories as Record<string, unknown> | null)?.[payload.category ?? "general"];
  if (categoryEnabled === false) return { attempted: 0, sent: 0, removed: 0, failed: 0, skipped: "disabled" };
  if (isWithinQuietHours(new Date(), user?.timezone ?? "Europe/Rome", preferences.quietHoursStart, preferences.quietHoursEnd)) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0, skipped: "quiet_hours" };
  }
  if (subscriptions.length === 0) return { attempted: 0, sent: 0, removed: 0, failed: 0, skipped: "no_subscriptions" };

  const result: PushSendResult = { attempted: subscriptions.length, sent: 0, removed: 0, failed: 0 };
  for (const subscription of subscriptions) {
    try {
      const response = await sendWebPush(subscription, payload, credentials);
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id, userId } });
        result.removed += 1;
      } else if (status >= 200 && status < 300) {
        await prisma.pushSubscription.updateMany({ where: { id: subscription.id, userId }, data: { lastSuccessAt: new Date() } });
        result.sent += 1;
      } else {
        result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
