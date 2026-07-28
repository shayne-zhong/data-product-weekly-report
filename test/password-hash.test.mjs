import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { hashPassword, needsRehash, verifyPassword } from "../lib/password-hash.mjs";

test("hashes with scrypt and verifies the same password", async () => {
  const salt = "salt_test1";
  const { hashAlgorithm, passwordHash } = await hashPassword("correct horse", salt);

  assert.equal(hashAlgorithm, "scrypt");
  assert.notEqual(passwordHash, "correct horse");
  assert.equal(await verifyPassword("correct horse", { salt, passwordHash, hashAlgorithm }), true);
  assert.equal(await verifyPassword("wrong password", { salt, passwordHash, hashAlgorithm }), false);
});

test("new hashes never need a rehash, legacy or missing algorithm markers do", async () => {
  const salt = "salt_test2";
  const { hashAlgorithm, passwordHash } = await hashPassword("hunter2", salt);

  assert.equal(needsRehash({ hashAlgorithm, passwordHash }), false);
  assert.equal(needsRehash({ hashAlgorithm: "sha256", passwordHash }), true);
  assert.equal(needsRehash({ passwordHash }), true);
});

test("still verifies legacy sha256 password hashes created before the scrypt migration", async () => {
  const salt = "salt_legacy";
  const password = "legacy-password";
  const legacyHash = createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
  const legacyUser = { salt, passwordHash: legacyHash };

  assert.equal(await verifyPassword(password, legacyUser), true);
  assert.equal(await verifyPassword("wrong", legacyUser), false);
  assert.equal(needsRehash(legacyUser), true);
});
