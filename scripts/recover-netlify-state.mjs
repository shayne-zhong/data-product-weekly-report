import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { assembleLegacyNetlifyState } from "../lib/legacy-netlify-state.mjs";
import { fingerprintState } from "../lib/state-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const netlifyArgs = ["--yes", "netlify-cli"];

async function netlify(...args) {
  const { stdout } = await execFileAsync(npx, [...netlifyArgs, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  return stdout;
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

const listing = JSON.parse(await netlify("blobs:list", "weekly-report", "--json"));
const keys = (listing.blobs || []).map((blob) => blob.key);
if (!keys.length) throw new Error("Netlify weekly-report store is empty");

const entries = await mapConcurrent(keys, 10, async (key) => {
  const raw = await netlify("blobs:get", "weekly-report", key);
  return [key, JSON.parse(raw)];
});
const { state, ignoredSessions } = assembleLegacyNetlifyState(entries);
const fingerprint = fingerprintState(state);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = process.env.MIGRATION_BACKUP_DIR || join("backups", "migration", stamp);
const stateFile = join(backupDir, "state-v1.json");
const metadataFile = join(backupDir, "state-v1.metadata.json");
const metadata = {
  source: "netlify-blob-legacy-backup",
  sourceStore: "weekly-report",
  exportedAt: new Date().toISOString(),
  sourceRecordCount: keys.length,
  ignoredSessions,
  fingerprint,
};

await mkdir(backupDir, { recursive: true });
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ stateFile, metadataFile, metadata }, null, 2));
