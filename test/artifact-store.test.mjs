import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createArtifactStore } from "../lib/artifact-store.mjs";

test("writes reads and removes an artifact", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createArtifactStore({ rootDir: root });

  await store.put("abc.pdf", Buffer.from("value"));
  assert.equal((await store.read("abc.pdf")).toString(), "value");
  assert.equal(await store.exists("abc.pdf"), true);

  await store.remove("abc.pdf");
  assert.equal(await store.exists("abc.pdf"), false);
});

test("rejects traversal and malformed storage keys", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createArtifactStore({ rootDir: root });

  await assert.rejects(() => store.put("../escape.pdf", Buffer.from("bad")), /存储键/);
  await assert.rejects(() => store.read("folder/file.pdf"), /存储键/);
});

test("replaces an existing key atomically and treats missing deletes as success", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createArtifactStore({ rootDir: root });

  await store.put("same.pdf", Buffer.from("first"));
  await store.put("same.pdf", Buffer.from("second"));
  assert.equal((await store.read("same.pdf")).toString(), "second");
  await assert.doesNotReject(() => store.remove("missing.pdf"));
});
