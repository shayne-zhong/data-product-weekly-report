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
  if (Array.isArray(result?.data?.list)) return result.data.list[0] || null;
  return result?.data || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyStateChanges(current, base, next, path = []) {
  if (sameValue(base, next)) return current === undefined ? structuredClone(next) : current;
  if (!isPlainObject(base) || !isPlainObject(next)) return structuredClone(next);
  const merged = isPlainObject(current) ? structuredClone(current) : {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (!(key in next)) {
      delete merged[key];
      continue;
    }
    const staleTaskUpdateAfterDelete = path.length === 1
      && path[0] === "tasks"
      && Object.hasOwn(base, key)
      && merged[key] === undefined;
    if (staleTaskUpdateAfterDelete) continue;
    merged[key] = applyStateChanges(merged[key], base[key], next[key], [...path, key]);
  }
  return merged;
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
  let vercelBlobEtag = null;

  const cloudbaseEnabled = Boolean(env.CLOUDBASE_ENV_ID || env.TCB_ENV);

  async function getCloudbaseDatabase() {
    if (resolvedCloudbaseDatabase) return resolvedCloudbaseDatabase;
    const sdkModule = await import("@cloudbase/node-sdk");
    const cloudbase = sdkModule.default || sdkModule;
    const envId = env.CLOUDBASE_ENV_ID || env.TCB_ENV;

    // Container CloudRun does not auto-inject TENCENTCLOUD_SECRETID/KEY/TOKEN.
    // Per CloudBase docs: pass CLOUDBASE_APIKEY explicitly as accessKey.
    // https://docs.cloudbase.net/api-reference/server/node-sdk/initialization
    const initOptions = { env: envId };
    const apiKey = String(env.CLOUDBASE_APIKEY || "").trim();
    if (apiKey) {
      initOptions.accessKey = apiKey;
    }

    const app = cloudbase.init(initOptions);
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
        try {
          const database = await getCloudbaseDatabase();
          const record = firstRecord(await database.collection(collectionName).doc(documentId).get());
          return record?.payload || null;
        } catch (error) {
          console.error("CloudBase state load failed:", error?.message || error);
          if (env.NODE_ENV === "production") throw error;
          console.error("Falling back to local state storage. Add CLOUDBASE_APIKEY for persistent state.");
          if (memoryState) return memoryState;
          try {
            memoryState = JSON.parse(await readFile(localPath, "utf8"));
          } catch {
            memoryState = null;
          }
          return memoryState;
        }
      }

      const store = await getNetlifyStore();
      if (store) return await store.get("state-v1.json", { type: "json" });

      const blob = await getVercelBlob();
      if (blob) {
        try {
          const result = await blob.get(blobPath, { access: "private", useCache: false });
          if (result?.stream) {
            vercelBlobEtag = result.blob?.etag || result.etag || null;
            return JSON.parse(await new Response(result.stream).text());
          }
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

    async save(state, { baseState } = {}) {
      if (cloudbaseEnabled) {
        try {
          const database = await getCloudbaseDatabase();
          if (baseState && typeof database.runTransaction === "function") {
            let persistedState = state;
            await database.runTransaction(async (transaction) => {
              const document = transaction.collection(collectionName).doc(documentId);
              const record = firstRecord(await document.get());
              const payload = applyStateChanges(record?.payload || {}, baseState, state);
              await document.set({ schemaVersion: 1, updatedAt: now(), payload });
              persistedState = payload;
            });
            return persistedState;
          }
          await database.collection(collectionName).doc(documentId).set({
            schemaVersion: 1,
            updatedAt: now(),
            payload: state,
          });
          return state;
        } catch (error) {
          console.error("CloudBase state save failed:", error?.message || error);
          if (env.NODE_ENV === "production") throw error;
          console.error("Falling back to local state storage. Add CLOUDBASE_APIKEY for persistent state.");
          memoryState = state;
          await writeFile(localPath, JSON.stringify(state), "utf8");
          return state;
        }
      }

      const store = await getNetlifyStore();
      if (store) {
        await store.setJSON("state-v1.json", state);
        return state;
      }

      const blob = await getVercelBlob();
      if (blob) {
        const saved = await blob.put(blobPath, JSON.stringify(state), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json; charset=utf-8",
          ...(vercelBlobEtag ? { ifMatch: vercelBlobEtag } : {}),
        });
        vercelBlobEtag = saved?.etag || saved?.blob?.etag || null;
        return state;
      }

      requireDurableProvider();
      memoryState = state;
      await writeFile(localPath, JSON.stringify(state), "utf8");
      return state;
    },
  };
}
