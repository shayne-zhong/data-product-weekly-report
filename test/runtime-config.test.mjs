import test from "node:test";
import assert from "node:assert/strict";

import {
  adminCredentialsValid,
  reportSyncKey,
  validateProductionConfig,
} from "../lib/runtime-config.mjs";

test("production rejects missing secrets", () => {
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: "production" }),
    /REPORT_SYNC_KEY.*ADMIN_USERNAME.*ADMIN_PASSWORD/,
  );
});

test("credentials come only from environment variables", () => {
  const env = {
    REPORT_SYNC_KEY: "sync-test-value",
    ADMIN_USERNAME: "operator",
    ADMIN_PASSWORD: "admin-test-value",
  };

  assert.equal(reportSyncKey(env), "sync-test-value");
  assert.equal(adminCredentialsValid("operator", "admin-test-value", env), true);
  assert.equal(adminCredentialsValid("admin", "888888", env), false);
});

test("missing runtime credentials never authenticate", () => {
  assert.equal(reportSyncKey({}), "");
  assert.equal(adminCredentialsValid("admin", "888888", {}), false);
});
