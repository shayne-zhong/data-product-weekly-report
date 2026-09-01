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

test("CloudBase transaction does not resurrect a deleted task from a stale task update", async () => {
  const database = fakeDatabase();
  const options = { env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" }, cloudbaseDatabase: database };
  const deletingInstance = createStateStore(options);
  const staleInstance = createStateStore(options);
  const initial = { tasks: { taskA: { id: "taskA", title: "删除前" } } };
  await deletingInstance.save(initial);

  const deleteBase = await deletingInstance.load();
  const staleBase = await staleInstance.load();
  const afterDelete = structuredClone(deleteBase);
  const staleUpdate = structuredClone(staleBase);
  delete afterDelete.tasks.taskA;
  staleUpdate.tasks.taskA.title = "旧页面仍在保存";

  await deletingInstance.save(afterDelete, { baseState: deleteBase });
  await staleInstance.save(staleUpdate, { baseState: staleBase });

  assert.deepEqual(await deletingInstance.load(), { tasks: {} });
});

test("CloudBase transaction preserves unrelated state when transaction reads return data.list", async () => {
  const database = fakeDatabase();
  const originalCollection = database.collection.bind(database);
  database.runTransaction = async (callback) => callback({
    collection(name) {
      const collection = originalCollection(name);
      return {
        doc(id) {
          const document = collection.doc(id);
          return {
            ...document,
            async get() {
              const result = await document.get();
              return { data: { list: result.data } };
            },
          };
        },
      };
    },
  });
  const store = createStateStore({
    env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: database,
  });
  const initial = { users: { alice: { username: "alice" } }, tasks: { taskA: { id: "taskA" } }, loginAttempts: {} };
  await store.save(initial);
  const base = await store.load();
  const next = structuredClone(base);
  next.loginAttempts.alice = { failures: 1 };

  await store.save(next, { baseState: base });

  assert.deepEqual(await store.load(), next);
});

test("CloudBase transaction persists normalized fields that are missing from legacy state", async () => {
  const database = fakeDatabase();
  const store = createStateStore({
    env: { NODE_ENV: "production", CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: database,
  });
  await store.save({ users: {}, tasks: {} });
  const base = { users: {}, tasks: {}, sessions: {}, loginAttempts: {} };
  const next = structuredClone(base);
  next.loginAttempts.alice = { failures: 1 };

  await store.save(next, { baseState: base });

  assert.deepEqual(await store.load(), next);
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

test("Vercel Blob writes use the loaded ETag as a conditional update", async () => {
  const puts = [];
  const blob = {
    async get() {
      return { blob: { etag: "etag-1" }, stream: new Blob([JSON.stringify({ tasks: {} })]).stream() };
    },
    async put(pathname, value, options) {
      puts.push([pathname, JSON.parse(value), options]);
      return { etag: "etag-2" };
    },
  };
  const store = createStateStore({
    env: { NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "token" },
    vercelBlob: blob,
  });
  const base = await store.load();
  const next = { tasks: { taskA: { id: "taskA" } } };

  await store.save(next, { baseState: base });

  assert.equal(puts[0][2].ifMatch, "etag-1");
  assert.equal(puts[0][2].access, "private");
});

test("Vercel Blob retries an ETag conflict and merges the latest unrelated state", async () => {
  let reads = 0;
  const puts = [];
  const blob = {
    async get() {
      reads += 1;
      const state = reads === 1
        ? { tasks: {}, settings: { theme: "light" }, sessions: {} }
        : { tasks: {}, settings: { theme: "dark" }, sessions: {} };
      return { blob: { etag: `etag-${reads}` }, stream: new Blob([JSON.stringify(state)]).stream() };
    },
    async put(pathname, value, options) {
      puts.push([pathname, JSON.parse(value), options]);
      if (puts.length === 1) {
        const error = new Error("ETag mismatch");
        error.name = "BlobPreconditionFailedError";
        throw error;
      }
      return { etag: "etag-3" };
    },
  };
  const store = createStateStore({
    env: { NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "token" },
    vercelBlob: blob,
  });
  const base = await store.load();
  const next = structuredClone(base);
  next.sessions.login = { username: "alice" };

  const persisted = await store.save(next, { baseState: base });

  assert.equal(reads, 2);
  assert.equal(puts.length, 2);
  assert.equal(puts[1][2].ifMatch, "etag-2");
  assert.deepEqual(persisted, {
    tasks: {},
    settings: { theme: "dark" },
    sessions: { login: { username: "alice" } },
  });
});

test("Vercel Blob SDK supports cache-bypassed consistent private reads", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies["@vercel/blob"], "^2.8.0");
});
