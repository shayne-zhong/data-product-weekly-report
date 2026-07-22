import test from "node:test";
import assert from "node:assert/strict";

import { downloadVercelState } from "../lib/vercel-state-source.mjs";

test("downloads private Vercel state through the official Blob API", async () => {
  const calls = [];
  const state = { users: { alice: { username: "alice" } } };
  const blobApi = {
    async get(pathname, options) {
      calls.push({ pathname, options });
      return {
        stream: new Blob([JSON.stringify(state)]).stream(),
        pathname,
        size: 42,
        uploadedAt: new Date("2026-07-22T00:00:00.000Z"),
      };
    },
  };

  const result = await downloadVercelState({
    blobApi,
    token: "secret-token",
    pathname: "data-product-weekly-report/state-v1.json",
  });

  assert.deepEqual(calls, [
    {
      pathname: "data-product-weekly-report/state-v1.json",
      options: { access: "private", useCache: false, token: "secret-token" },
    },
  ]);
  assert.deepEqual(result.state, state);
  assert.equal(result.metadata.pathname, "data-product-weekly-report/state-v1.json");
});

test("rejects a missing Blob payload", async () => {
  const blobApi = { async get() { return null; } };

  await assert.rejects(
    downloadVercelState({ blobApi, token: "secret-token", pathname: "state.json" }),
    /not found/i,
  );
});
