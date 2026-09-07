import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createStateStore, defaultLocalStatePath } from "../lib/state-store.mjs";

test("Vercel Blob store round-trips the state document", async () => {
  let value = null;
  const blob = {
    async get() {
      return value === null ? null : { stream: new Blob([value]).stream() };
    },
    async put(pathname, nextValue, options) {
      assert.equal(pathname, "data-product-weekly-report/state-v1.json");
      assert.equal(options.access, "private");
      value = nextValue;
      return { pathname };
    },
  };
  const store = createStateStore({
    env: { NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "token" },
    vercelBlob: blob,
  });
  const state = { users: { alice: { username: "alice" } } };

  await store.save(state);

  assert.deepEqual(await store.load(), state);
});

test("Node production uses an explicit local state path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-state-test-"));
  const statePath = join(directory, "state.json");
  const store = createStateStore({ env: { NODE_ENV: "production", STATE_PATH: statePath } });
  const state = { tasks: { taskA: { id: "taskA" } } };

  try {
    await store.save(state);
    assert.deepEqual(await store.load(), state);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production rejects missing Vercel Blob and Node state storage", async () => {
  const store = createStateStore({ env: { NODE_ENV: "production" } });

  await assert.rejects(() => store.load(), /durable state storage is not configured/i);
  await assert.rejects(() => store.save({}), /durable state storage is not configured/i);
});

test("default local state path is stable across process restarts", () => {
  assert.equal(defaultLocalStatePath(4321, {}), defaultLocalStatePath(9876, {}));
  assert.match(defaultLocalStatePath(4321, {}), /data-product-weekly-report-state-v1\.json$/);
});

test("test fallback state does not collide when a process id is reused", () => {
  const env = { NODE_TEST_CONTEXT: "child-v8" };
  const firstRun = defaultLocalStatePath(4321, env, "run-a");
  const secondRun = defaultLocalStatePath(4321, env, "run-b");

  assert.notEqual(firstRun, secondRun);
  assert.equal(firstRun, defaultLocalStatePath(4321, env, "run-a"));
});

test("runtime dependencies only include Vercel Blob", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(manifest.dependencies["@vercel/blob"], "^2.8.0");
  assert.equal(manifest.dependencies["@cloudbase/node-sdk"], undefined);
  assert.equal(manifest.dependencies["@netlify/blobs"], undefined);
});
