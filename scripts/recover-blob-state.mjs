import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const statePath = "data-product-weekly-report/state-v1.json";
const dashboardUrl = "https://vercel.com/zhongnh/~/stores/blob/store_8f6svA7lH7bBsRAR";

async function loadLocalToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const env = await readFile(".env.local", "utf8");
    const line = env.split(/\r?\n/).find((item) => item.startsWith("BLOB_READ_WRITE_TOKEN="));
    return line ? line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "") : "";
  } catch {
    return "";
  }
}

function summarizeState(data) {
  return {
    weeks: Object.keys(data.weeks || {}).length,
    tasks: Object.keys(data.tasks || {}).length,
    reports: Object.keys(data.reports || {}).length,
    goalsRows: data.goals?.rows?.length || 0,
    users: Object.keys(data.users || {}).length,
    weekIds: Object.keys(data.weeks || {}).slice(0, 10),
    taskSamples: Object.values(data.tasks || {}).slice(0, 10).map((task) => ({
      title: task.title,
      status: task.status,
      weekId: task.weekId,
      updatedAt: task.updatedAt,
    })),
  };
}

const token = await loadLocalToken();
if (!token) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Pull env from Vercel or set it locally first.");
  process.exit(1);
}

const { head } = await import("@vercel/blob");
const blob = await head(statePath, { token });
console.log("Blob metadata:", JSON.stringify({
  pathname: blob.pathname,
  size: blob.size,
  uploadedAt: blob.uploadedAt,
  dashboardUrl,
}, null, 2));

const response = await fetch(blob.downloadUrl, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!response.ok) {
  const text = await response.text().catch(() => "");
  console.error(`Unable to download blob: ${response.status} ${response.statusText}`);
  if (text) console.error(text);
  console.error(`Open Vercel and reactivate the Blob Store first: ${dashboardUrl}`);
  process.exit(2);
}

const text = await response.text();
const data = JSON.parse(text);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join("..", "..", "outputs", "recovery", `state-v1-${stamp}.json`);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, text, "utf8");

console.log("Recovered state backup:", outFile);
console.log("Summary:", JSON.stringify(summarizeState(data), null, 2));
