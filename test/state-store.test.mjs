import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createStateStore, defaultLocalStatePath } from "../lib/state-store.mjs";

function fakeDatabase() {
  const records = new Map();
  const database = {
    records,
    collection(name) {
      assert.equal(name, "workbench_state");
      return {
        doc(id) {
          return {
            async get() {
              return { data: records.has(id) ? [records.get(id)] : [] };
            },
            async set(value) {
              records.set(id, { _id: id, ...value });
              return { updated: 1 };
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      return callback(database);
    },
  };
  return database;
}

test("CloudBase store round-trips the state document", async () => {
  const database = fakeDatabase();
  const store = createStateStore({
    env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: database,
    now: () => 123456,
  });
  const state = { users: { alice: { username: "alice" } } };

  await store.save(state);

  assert.deepEqual(await store.load(), state);
  assert.deepEqual(database.records.get("state-v1"), {
    _id: "state-v1",
    schemaVersion: 1,
    updatedAt: 123456,
    payload: state,
  });
});

test("CloudBase store returns null before the first import", async () => {
  const store = createStateStore({
    env: { NODE_ENV: "production", TCB_ENV: "env-test" },
    cloudbaseDatabase: fakeDatabase(),
  });

  assert.equal(await store.load(), null);
});

test("CloudBase transaction preserves a task deletion across stale instance saves", async () => {
  const database = fakeDatabase();
  const options = { env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" }, cloudbaseDatabase: database };
  const firstInstance = createStateStore(options);
  const secondInstance = createStateStore(options);
  const initial = { tasks: { taskA: { id: "taskA", title: "待删除" } }, settings: { theme: "light" } };
  await firstInstance.save(initial);

  const firstBase = await firstInstance.load();
  const secondBase = await secondInstance.load();
  const afterDelete = structuredClone(firstBase);
  const staleSettingsSave = structuredClone(secondBase);
  delete afterDelete.tasks.taskA;
  staleSettingsSave.settings.theme = "dark";

  await firstInstance.save(afterDelete, { baseState: firstBase });
  await secondInstance.save(staleSettingsSave, { baseState: secondBase });

  assert.deepEqual(await firstInstance.load(), { tasks: {}, settings: { theme: "dark" } });
});

test("production never falls back to temporary disk", async () => {
  const store = createStateStore({ env: { NODE_ENV: "production" } });

  await assert.rejects(() => store.load(), /durable state storage is not configured/i);
  await assert.rejects(() => store.save({}), /durable state storage is not configured/i);
});

test("production surfaces CloudBase write failures instead of reporting a temporary-disk success", async () => {
  const database = fakeDatabase();
  database.collection = () => ({ doc: () => ({
    async set() { throw new Error("cloud write failed"); },
  }) });
  const store = createStateStore({
    env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: database,
  });

  await assert.rejects(() => store.save({ tasks: {} }), /cloud write failed/);
});

test("production surfaces CloudBase read failures instead of serving stale local state", async () => {
  const database = fakeDatabase();
  database.collection = () => ({ doc: () => ({
    async get() { throw new Error("cloud read failed"); },
  }) });
  const store = createStateStore({
    env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: database,
  });

  await assert.rejects(() => store.load(), /cloud read failed/);
});

test("local fallback state survives a server process restart", () => {
  assert.equal(defaultLocalStatePath(4321, {}), defaultLocalStatePath(9876, {}));
  assert.match(defaultLocalStatePath(4321, {}), /data-product-weekly-report-state-v1\.json$/);
});

test("production uses the CloudBase SDK version that supports API key authentication", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(manifest.dependencies["@cloudbase/node-sdk"], "4.0.3");
});
