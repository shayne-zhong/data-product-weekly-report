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
} = {}) {
  const root = path.resolve(rootDir);

  async function prepare() {
    await mkdir(root, { recursive: true });
  }

  return {
    rootDir: root,
    async put(key, value) {
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
      return readFile(validPath(root, key));
    },
    async remove(key) {
      await rm(validPath(root, key), { force: true });
    },
    async exists(key) {
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
