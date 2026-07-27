import test from "node:test";
import assert from "node:assert/strict";

import { decryptSecret, encryptSecret, maskSecret } from "../lib/encrypted-secret.mjs";

const env = { SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
const fallbackEnv = { ADMIN_SESSION_SECRET: "department-workbench-admin-session-secret" };

test("AI keys round-trip without storing plaintext", async () => {
  const encrypted = await encryptSecret("sk-secret-1234", { env });

  assert.equal(JSON.stringify(encrypted).includes("sk-secret-1234"), false);
  assert.equal(await decryptSecret(encrypted, { env }), "sk-secret-1234");
  assert.equal(maskSecret("sk-secret-1234"), "•••• 1234");
  assert.equal(encrypted.algorithm, "AES-256-GCM");
  assert.equal(encrypted.version, 1);
});

test("AI keys can be encrypted with the admin session secret when no dedicated key exists", async () => {
  const encrypted = await encryptSecret("sk-fallback-5678", { env: fallbackEnv });

  assert.equal(JSON.stringify(encrypted).includes("sk-fallback-5678"), false);
  assert.equal(await decryptSecret(encrypted, { env: fallbackEnv }), "sk-fallback-5678");
});

test("missing or malformed encryption keys never fall back to plaintext", async () => {
  await assert.rejects(() => encryptSecret("secret", { env: {} }), /SETTINGS_ENCRYPTION_KEY|ADMIN_SESSION_SECRET/);
  await assert.rejects(
    () => encryptSecret("secret", { env: { SETTINGS_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") } }),
    /32 bytes/,
  );
});

test("tampered ciphertext cannot be decrypted", async () => {
  const encrypted = await encryptSecret("sk-secret-1234", { env });
  encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}aa`;
  await assert.rejects(() => decryptSecret(encrypted, { env }));
});
