import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";

const storageKeyPattern = /^[a-zA-Z0-9._-]+$/;

function validPath(rootDir, key) {
  if (!storageKeyPattern.test(String(key || ""))) throw new Error("无效的产物存储键");
  const target = path.resolve(rootDir, key);
  if (path.dirname(target) !== rootDir) throw new Error("无效的产物存储键");
  return target;
}

export function createArtifactStore({
  rootDir = process.env.ARTIFACT_STORAGE_DIR || path.resolve(process.cwd(), "data", "artifacts"),
  env = process.env,
  vercelBlob = null,
} = {}) {
  const root = path.resolve(rootDir);

  async function blobClient() {
    if (!env.BLOB_READ_WRITE_TOKEN) return null;
    return vercelBlob || await import("@vercel/blob");
  }

  function blobKey(key) {
    validPath(root, key);
    return `data-product-weekly-report/artifacts/${key}`;
  }

  async function prepare() {
    await mkdir(root, { recursive: true });
  }

  return {
    rootDir: root,
    async put(key, value) {
      const blob = await blobClient();
      if (blob) {
        await blob.put(blobKey(key), Buffer.isBuffer(value) ? value : Buffer.from(value), {
          access: "private",
          allowOverwrite: true,
        });
        return;
      }
      await prepare();
      const target = validPath(root, key);
      const temporary = validPath(root, `${key}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, Buffer.isBuffer(value) ? value : Buffer.from(value));
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async read(key) {
      const blob = await blobClient();
      if (blob) {
        const result = await blob.get(blobKey(key), { access: "private", useCache: false });
        if (!result?.stream) throw Object.assign(new Error("Artifact not found"), { code: "ENOENT" });
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      }
      return readFile(validPath(root, key));
    },
    async remove(key) {
      const blob = await blobClient();
      if (blob) {
        await blob.del(blobKey(key));
        return;
      }
      await rm(validPath(root, key), { force: true });
    },
    async exists(key) {
      const blob = await blobClient();
      if (blob) {
        try {
          await blob.head(blobKey(key));
          return true;
        } catch (error) {
          if (error?.status === 404 || error?.statusCode === 404) return false;
          throw error;
        }
      }
      try {
        await access(validPath(root, key));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
  };
}
