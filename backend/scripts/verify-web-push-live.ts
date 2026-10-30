import { getVapidCredentials, sendWebPush } from "../api/src/modules/domain/web-push.js";

for (const key of ["PUSH_TEST_ENDPOINT", "PUSH_TEST_P256DH", "PUSH_TEST_AUTH"]) {
  if (!process.env[key]) throw new Error(key + " is required; use a disposable browser subscription from staging.");
}
const response = await sendWebPush({
  endpoint: process.env.PUSH_TEST_ENDPOINT!,
  p256dh: process.env.PUSH_TEST_P256DH!,
  authSecret: process.env.PUSH_TEST_AUTH!,
}, {
  title: "Vivarqo — test Web Push",
  body: "Notifica di verifica inviata dall'ambiente staging.",
  url: "/settings/notifications",
  category: "system",
}, getVapidCredentials());
await response.body?.cancel().catch(() => undefined);
if (response.status < 200 || response.status >= 300) {
  throw new Error("Push provider rejected the notification with HTTP " + response.status + ".");
}
process.stdout.write("Provider accepted encrypted test push with HTTP " + response.status + ". Confirm arrival manually in the browser.\n");
