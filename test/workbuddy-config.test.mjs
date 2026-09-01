import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveWorkbuddyConfig,
  publicWorkbuddyConfig,
  validateWorkbuddyConfigPatch,
} from "../lib/workbuddy-config.mjs";

test("admin overrides environment while explicit disable wins", async () => {
  const decrypt = async (value) => value.plaintext;
  const env = {
    WORKBUDDY_OPEN_API_TOKEN: "environment-open-token-1234",
    WORKBUDDY_DEPARTMENT_ID: "data-product",
    WORKBUDDY_OAUTH_RESOLVER_URL: "http://environment/resolve",
    WORKBUDDY_OAUTH_RESOLVER_TOKEN: "environment-oauth-token-1234",
    WECOM_OAUTH_CORP_ID: "corp-env",
  };
  const state = {
    workbuddy: {
      enabled: false,
      openApiToken: {
        encrypted: { plaintext: "admin-open-token-123456" },
        last4: "3456",
      },
    },
  };

  const config = await effectiveWorkbuddyConfig(state, { env, decrypt });

  assert.equal(config.enabled, false);
  assert.equal(config.openApiToken, "admin-open-token-123456");
  assert.equal(config.departmentId, "data-product");
});

test("public projection exposes masks and sources but no secret", () => {
  const config = publicWorkbuddyConfig({
    workbuddy: {
      openApiToken: { encrypted: { ciphertext: "secret" }, last4: "1234" },
    },
  }, {
    env: { WORKBUDDY_OAUTH_RESOLVER_TOKEN: "environment-oauth-token-5678" },
  });

  assert.deepEqual(config.openApiToken, {
    configured: true,
    source: "admin",
    mask: "•••• 1234",
  });
  assert.deepEqual(config.oauthResolverToken, {
    configured: true,
    source: "environment",
    mask: "•••• 5678",
  });
  assert.doesNotMatch(JSON.stringify(config), /ciphertext|environment-oauth-token/);
});

test("patch validation rejects short identical tokens and invalid URLs", () => {
  assert.throws(
    () => validateWorkbuddyConfigPatch({ open_api_token: "short" }),
    /24/,
  );
  assert.throws(() => validateWorkbuddyConfigPatch({
    open_api_token: "same-token-value-123456789",
    oauth_resolver_token: "same-token-value-123456789",
  }), /different/);
  assert.throws(
    () => validateWorkbuddyConfigPatch({ oauth_resolver_url: "file:///tmp/a" }),
    /http/,
  );
});
