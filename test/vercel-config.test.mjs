import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("Vercel deploys the built SPA through the Node service entrypoint", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

  assert.equal(config.buildCommand, "npm run build");
  assert.equal(config.outputDirectory, undefined);
  assert.equal(config.rewrites, undefined);
  assert.deepEqual(config.crons, [
    { path: "/api/internal/weekly-rollover", schedule: "5 16 * * 0" },
    { path: "/api/internal/report-auto-archive", schedule: "0 12 * * *" },
  ]);

  await access(new URL("../server.mjs", import.meta.url));
});
