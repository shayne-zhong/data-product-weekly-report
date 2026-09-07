import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fingerprintState } from "../lib/state-fingerprint.mjs";
import { downloadVercelState } from "../lib/vercel-state-source.mjs";

const statePath = "data-product-weekly-report/state-v1.json";

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    values[name] = value.replaceAll("\\n", "\n");
  }
  return values;
}

async function loadToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const envFile = process.env.MIGRATION_ENV_FILE || ".env.local";
  try {
    const values = parseEnvFile(await readFile(envFile, "utf8"));
    return values.BLOB_READ_WRITE_TOKEN || "";
  } catch {
    return "";
  }
}

const token = await loadToken();
if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN in the process or MIGRATION_ENV_FILE");

const blobApi = await import("@vercel/blob");
const { state, metadata: blob } = await downloadVercelState({
  blobApi,
  token,
  pathname: statePath,
});
const fingerprint = fingerprintState(state);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = process.env.MIGRATION_BACKUP_DIR || join("backups", "migration", stamp);
const stateFile = join(backupDir, "state-v1.json");
const metadataFile = join(backupDir, "state-v1.metadata.json");
const metadata = {
  source: "vercel-blob",
  pathname: blob.pathname,
  blobSize: blob.size,
  uploadedAt: blob.uploadedAt,
  exportedAt: new Date().toISOString(),
  fingerprint,
};

await mkdir(backupDir, { recursive: true });
await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ stateFile, metadataFile, metadata }, null, 2));
