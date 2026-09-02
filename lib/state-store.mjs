import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const blobPath = "data-product-weekly-report/state-v1.json";
const testRunId = randomUUID();

export function defaultLocalStatePath(pid = process.pid, env = process.env, runId = testRunId) {
  if (env.STATE_PATH) return env.STATE_PATH;
  const suffix = env.NODE_TEST_CONTEXT ? `-${pid}-${runId}` : "";
  return join(tmpdir(), `data-product-weekly-report-state-v1${suffix}.json`);
}

export function createStateStore({
  env = process.env,
  vercelBlob = null,
  localPath = defaultLocalStatePath(process.pid, env),
} = {}) {
  let memoryState = null;
  let resolvedVercelBlob = vercelBlob;

  async function getVercelBlob() {
    if (resolvedVercelBlob) return resolvedVercelBlob;
    if (!env.BLOB_READ_WRITE_TOKEN) return null;
    resolvedVercelBlob = await import("@vercel/blob");
    return resolvedVercelBlob;
  }

  function requireDurableProvider() {
    if (env.NODE_ENV === "production" && !env.STATE_PATH) {
      throw new Error("Durable state storage is not configured for production");
    }
  }

  return {
    async load() {
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
      const blob = await getVercelBlob();
      if (blob) {
        await blob.put(blobPath, JSON.stringify(state), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json; charset=utf-8",
        });
        return state;
      }

      requireDurableProvider();
      memoryState = state;
      await writeFile(localPath, JSON.stringify(state), "utf8");
      return state;
    },
  };
}
