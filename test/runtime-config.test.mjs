import test from "node:test";
import assert from "node:assert/strict";

import {
  adminCredentialsValid,
  validateProductionConfig,
} from "../lib/runtime-config.mjs";

test("production rejects missing secrets", () => {
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: "production" }),
    /ADMIN_USERNAME.*ADMIN_PASSWORD.*ADMIN_SESSION_SECRET.*SETTINGS_ENCRYPTION_KEY.*CLOUDBASE_APIKEY/,
  );
});

test("production accepts a complete server-side CloudBase configuration", () => {
  assert.doesNotThrow(() => validateProductionConfig({
    NODE_ENV: "production",
    ADMIN_USERNAME: "operator",
    ADMIN_PASSWORD: "admin-test-value",
    ADMIN_SESSION_SECRET: "session-test-value",
    SETTINGS_ENCRYPTION_KEY: "settings-test-value",
    CLOUDBASE_APIKEY: "cloudbase-server-test-value",
  }));
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
