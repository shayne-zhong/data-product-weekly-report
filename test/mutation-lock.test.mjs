import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { createMutationLock } from "../lib/mutation-lock.mjs";

test("serializes overlapping critical sections in acquisition order", async () => {
  const lock = createMutationLock();
  const events = [];

  async function task(name, ms) {
    const release = await lock.acquire();
    events.push(`${name}:start`);
    await sleep(ms);
    events.push(`${name}:end`);
    release();
  }

  await Promise.all([task("a", 30), task("b", 5)]);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("a later waiter stays blocked until the current holder releases", async () => {
  const lock = createMutationLock();
  const releaseA = await lock.acquire();
  let bAcquired = false;
  const bPromise = lock.acquire().then((release) => {
    bAcquired = true;
    release();
  });

  await sleep(10);
  assert.equal(bAcquired, false);

  releaseA();
  await bPromise;
  assert.equal(bAcquired, true);
});

test("without serialization, an interleaved read-modify-write cycle loses an earlier update", async () => {
  const remote = { json: JSON.stringify({ tasks: {} }) };
  const load = async () => JSON.parse(remote.json);
  const save = async (state) => {
    remote.json = JSON.stringify(state);
  };

  const stateA = await load();
  const stateB = await load();
  stateA.tasks.a = true;
  await save(stateA);
  stateB.tasks.b = true;
  await save(stateB);

  assert.deepEqual(JSON.parse(remote.json).tasks, { b: true });
});

test("createMutationLock prevents concurrent read-modify-write cycles from losing updates", async () => {
  const remote = { json: JSON.stringify({ tasks: {} }) };
  const load = async () => {
    await sleep(1);
    return JSON.parse(remote.json);
  };
  const save = async (state) => {
    await sleep(1);
    remote.json = JSON.stringify(state);
  };
  const lock = createMutationLock();

  async function addTask(id) {
    const release = await lock.acquire();
    try {
      const state = await load();
      state.tasks[id] = true;
      await save(state);
    } finally {
      release();
    }
  }

  await Promise.all([addTask("a"), addTask("b"), addTask("c")]);

  assert.deepEqual(JSON.parse(remote.json).tasks, { a: true, b: true, c: true });
});

test("the lock is released even when the critical section throws", async () => {
  const lock = createMutationLock();

  await assert.rejects(async () => {
    const release = await lock.acquire();
    try {
      throw new Error("boom");
    } finally {
      release();
    }
  }, /boom/);

  const release = await lock.acquire();
  release();
});
