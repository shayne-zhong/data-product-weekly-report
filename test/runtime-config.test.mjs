import test from "node:test";
import assert from "node:assert/strict";

import { adminCredentialsValid, validateProductionConfig } from "../lib/runtime-config.mjs";

test("production rejects missing secrets", () => {
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: "production" }),
    /ADMIN_USERNAME.*ADMIN_PASSWORD.*ADMIN_SESSION_SECRET/,
  );
});

test("production accepts Node or Vercel configuration without a dedicated AI key encryption secret", () => {
  assert.doesNotThrow(() =>
    validateProductionConfig({
      NODE_ENV: "production",
      ADMIN_USERNAME: "operator",
      ADMIN_PASSWORD: "admin-test-value",
      ADMIN_SESSION_SECRET: "session-test-value",
    }),
  );
});

test("credentials come only from environment variables", () => {
  const env = {
    ADMIN_USERNAME: "operator",
    ADMIN_PASSWORD: "admin-test-value",
  };

  assert.equal(adminCredentialsValid("operator", "admin-test-value", env), true);
  assert.equal(adminCredentialsValid("admin", "888888", env), false);
});

test("missing runtime credentials never authenticate", () => {
  assert.equal(adminCredentialsValid("admin", "888888", {}), false);
});
