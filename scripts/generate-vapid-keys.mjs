#!/usr/bin/env node
import { createECDH } from "node:crypto";

const curve = createECDH("prime256v1");
curve.generateKeys();
console.log("# Add these values to your secret manager or .env (never commit real keys):");
console.log(\`VAPID_PUBLIC_KEY=\${curve.getPublicKey(undefined, "uncompressed").toString("base64url")}\`);
console.log(\`VAPID_PRIVATE_KEY=\${curve.getPrivateKey().toString("base64url")}\`);
console.log("VAPID_SUBJECT=mailto:admin@example.com");
