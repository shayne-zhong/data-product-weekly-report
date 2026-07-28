import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const blobPath = "data-product-weekly-report/state-v1.json";
const collectionName = "workbench_state";
const documentId = "state-v1";

export function defaultLocalStatePath(pid = process.pid, env = process.env) {
  const suffix = env.NODE_TEST_CONTEXT ? `-${pid}` : "";
  return join(tmpdir(), `data-product-weekly-report-state-v1${suffix}.json`);
}

function firstRecord(result) {
  if (Array.isArray(result?.data)) return result.data[0] || null;
  return result?.data || null;
}

export function createStateStore({
  env = process.env,
  cloudbaseDatabase = null,
  netlifyStore = null,
  vercelBlob = null,
  localPath = defaultLocalStatePath(),
  now = Date.now,
} = {}) {
  let memoryState = null;
  let resolvedCloudbaseDatabase = cloudbaseDatabase;
  let resolvedNetlifyStore = netlifyStore;
  let resolvedVercelBlob = vercelBlob;

  const cloudbaseEnabled = Boolean(env.CLOUDBASE_ENV_ID || env.TCB_ENV);

  async function getCloudbaseDatabase() {
    if (resolvedCloudbaseDatabase) return resolvedCloudbaseDatabase;
    const sdkModule = await import("@cloudbase/node-sdk");
    const cloudbase = sdkModule.default || sdkModule;
    const app = cloudbase.init({ env: env.CLOUDBASE_ENV_ID || env.TCB_ENV });
    resolvedCloudbaseDatabase = app.database();
    return resolvedCloudbaseDatabase;
  }

  async function getNetlifyStore() {
    if (resolvedNetlifyStore) return resolvedNetlifyStore;
    if (!env.NETLIFY) return null;
    const { getStore } = await import("@netlify/blobs");
    resolvedNetlifyStore = getStore({ name: "weekly-report", consistency: "strong" });
    return resolvedNetlifyStore;
  }

  async function getVercelBlob() {
    if (resolvedVercelBlob) return resolvedVercelBlob;
    if (!env.BLOB_READ_WRITE_TOKEN) return null;
    resolvedVercelBlob = await import("@vercel/blob");
    return resolvedVercelBlob;
  }

  function requireDurableProvider() {
    if (env.NODE_ENV === "production") {
      throw new Error("Durable state storage is not configured for production");
    }
  }

  return {
    async load() {
      if (cloudbaseEnabled) {
        const database = await getCloudbaseDatabase();
        const record = firstRecord(await database.collection(collectionName).doc(documentId).get());
        return record?.payload || null;
      }

      const store = await getNetlifyStore();
      if (store) return await store.get("state-v1.json", { type: "json" });

      const blob = await getVercelBlob();
      if (blob) {
        try {
          const result = await blob.get(blobPath, { access: "private", useCache: false });
          if (result?.stream) return JSON.parse(await new Response(result.stream).text());
        } catch (error) {
          if (env.VERCEL) throw new Error(`Cloud state load failed: ${error.message || error}`, { cause: error });
        }
        return null;
      }

      requireDurableProvider();
      if (memoryState) return memoryState;
      try {
        memoryState = JSON.parse(await readFile(localPath, "utf8"));
      } catch {
        memoryState = null;
      }
      return memoryState;
    },

    async save(state) {
      if (cloudbaseEnabled) {
        const database = await getCloudbaseDatabase();
        await database.collection(collectionName).doc(documentId).set({
          schemaVersion: 1,
          updatedAt: now(),
          payload: state,
        });
        return;
      }

      const store = await getNetlifyStore();
      if (store) {
        await store.setJSON("state-v1.json", state);
        return;
      }

      const blob = await getVercelBlob();
      if (blob) {
        await blob.put(blobPath, JSON.stringify(state), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json; charset=utf-8",
        });
        return;
      }

      requireDurableProvider();
      memoryState = state;
      await writeFile(localPath, JSON.stringify(state), "utf8");
    },
  };
}
