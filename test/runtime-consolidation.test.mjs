import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const removedRuntimeEntries = [
  "../cloudbaserc.json",
  "../cloudfunctions/weekly-task-rollover/index.js",
  "../cloudfunctions/report-auto-archive/index.js",
  "../netlify.toml",
  "../netlify/functions/api.mjs",
  "../scripts/import-cloudbase-state.mjs",
  "../scripts/recover-netlify-state.mjs",
  "../lib/legacy-netlify-state.mjs",
];

test("only Node and Vercel runtime entries remain", async () => {
  for (const entry of removedRuntimeEntries) {
    await assert.rejects(() => access(new URL(entry, import.meta.url)), { code: "ENOENT" });
  }
});
