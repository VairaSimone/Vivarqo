import test from "node:test";
import assert from "node:assert/strict";
import { isDashboardRequestAllowed } from "./dev-manager-security.mjs";

test("consente solo loopback e host locali attesi", () => {
  assert.equal(isDashboardRequestAllowed("127.0.0.1", "127.0.0.1:4179", 4179), true);
  assert.equal(isDashboardRequestAllowed("::1", "localhost:4179", 4179), true);
  assert.equal(isDashboardRequestAllowed("::ffff:127.0.0.1", "[::1]:4179", 4179), true);
});

test("rifiuta dispositivi di rete, host arbitrari e host-header rebinding", () => {
  assert.equal(isDashboardRequestAllowed("192.168.1.20", "192.168.1.20:4179", 4179), false);
  assert.equal(isDashboardRequestAllowed("10.0.0.5", "localhost:4179", 4179), false);
  assert.equal(isDashboardRequestAllowed("127.0.0.1", "attacker.example:4179", 4179), false);
  assert.equal(isDashboardRequestAllowed("127.0.0.1", "localhost:80", 4179), false);
});
