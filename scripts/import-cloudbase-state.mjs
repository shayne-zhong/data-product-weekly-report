import { readFile } from "node:fs/promises";

import { assertStateFingerprint } from "../lib/state-fingerprint.mjs";

const stateFile = process.env.MIGRATION_STATE_FILE;
const metadataFile = process.env.MIGRATION_METADATA_FILE;
const envId = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV;
if (!stateFile || !metadataFile || !envId) {
  throw new Error("MIGRATION_STATE_FILE, MIGRATION_METADATA_FILE, and CLOUDBASE_ENV_ID are required");
}

const state = JSON.parse(await readFile(stateFile, "utf8"));
const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
const source = assertStateFingerprint(state, metadata.fingerprint);
const maxDocumentBytes = 15 * 1024 * 1024;
if (source.bytes > maxDocumentBytes) {
  throw new Error(`State document is ${source.bytes} bytes and exceeds the safe CloudBase document limit ${maxDocumentBytes}`);
}

const sdkModule = await import("@cloudbase/node-sdk");
const cloudbase = sdkModule.default || sdkModule;
const app = cloudbase.init({
  env: envId,
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY,
  sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
});
const database = app.database();
const document = database.collection("workbench_state").doc("state-v1");
await document.set({ schemaVersion: 1, updatedAt: Date.now(), payload: state });
const result = await document.get();
const record = Array.isArray(result?.data) ? result.data[0] : result?.data;
if (!record?.payload) throw new Error("CloudBase state read-back returned no payload");
const destination = assertStateFingerprint(record.payload, source);

console.log(JSON.stringify({ envId, source, destination, verified: true }, null, 2));
