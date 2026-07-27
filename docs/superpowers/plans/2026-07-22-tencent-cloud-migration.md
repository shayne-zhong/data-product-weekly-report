# Tencent Cloud Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Securely migrate the department workbench and its complete Vercel Blob production state into the bound CloudBase environment, deploy it as one CloudBase Run service, and verify the real public deployment.

**Architecture:** A small Node HTTP server serves `public` and adapts `/api/*` requests to the existing handler. A provider-neutral state store keeps Vercel/Netlify compatibility while persisting Tencent production state in a server-only CloudBase NoSQL document. One-shot migration scripts export, fingerprint, import, and read back the state before CloudBase Run is deployed.

**Tech Stack:** Node.js ESM, Node HTTP server, CloudBase Node SDK, CloudBase NoSQL, CloudBase Run container deployment, Vercel Blob, Node test runner.

---

## File Map

- Create `lib/runtime-config.mjs`: production credential validation and constant-time credential comparison.
- Create `lib/state-store.mjs`: Vercel, Netlify, CloudBase, and local state persistence adapters.
- Modify `api/[...path].mjs`: use the new configuration and state-store boundaries.
- Modify `public/index.html`: remove hard-coded admin credentials and retain entered credentials only for the current browser session.
- Create `server.mjs`: production HTTP server for static assets, health checks, and the existing API handler.
- Create `scripts/build.mjs`: deterministic production artifact builder.
- Modify `scripts/recover-blob-state.mjs`: safe Vercel export with fingerprint and summary output.
- Create `scripts/import-cloudbase-state.mjs`: CloudBase import and read-back verification.
- Create `Dockerfile` and `.dockerignore`: CloudBase Run container build.
- Modify `package.json` and `package-lock.json`: production scripts and CloudBase dependency.
- Modify `.gitignore`: exclude migration credentials, backups, and build artifacts.
- Modify `vercel.json`: remove the committed sync key.
- Create `test/runtime-config.test.mjs`, `test/state-store.test.mjs`, `test/production-server.test.mjs`, and `test/migration-tools.test.mjs`.
- Modify existing API and UI tests to inject test-only credentials.

### Task 1: Remove hard-coded production credentials

**Files:**
- Create: `lib/runtime-config.mjs`
- Modify: `api/[...path].mjs`
- Modify: `public/index.html`
- Modify: `vercel.json`
- Test: `test/runtime-config.test.mjs`
- Test: `test/workbench-ui.test.mjs`
- Test: `test/department-api.test.mjs`
- Test: `test/persistence-api.test.mjs`
- Test: `test/report-api.test.mjs`

- [ ] **Step 1: Write failing configuration tests**

```js
test("production rejects missing secrets", () => {
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: "production" }),
    /REPORT_SYNC_KEY.*ADMIN_USERNAME.*ADMIN_PASSWORD/,
  );
});

test("credentials come only from environment variables", () => {
  const env = {
    REPORT_SYNC_KEY: "sync-test-value",
    ADMIN_USERNAME: "operator",
    ADMIN_PASSWORD: "admin-test-value",
  };
  assert.equal(reportSyncKey(env), "sync-test-value");
  assert.equal(adminCredentialsValid("operator", "admin-test-value", env), true);
  assert.equal(adminCredentialsValid("admin", "888888", env), false);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test test/runtime-config.test.mjs test/workbench-ui.test.mjs`

Expected: FAIL because `lib/runtime-config.mjs` does not exist and the UI still contains `888888`.

- [ ] **Step 3: Implement environment-only runtime configuration**

```js
import { timingSafeEqual } from "node:crypto";

function envText(env, name) {
  return String(env[name] || "").trim();
}

export function reportSyncKey(env = process.env) {
  return envText(env, "REPORT_SYNC_KEY");
}

export function adminCredentialsValid(username, password, env = process.env) {
  const expectedUser = envText(env, "ADMIN_USERNAME").toLowerCase();
  const expectedPassword = envText(env, "ADMIN_PASSWORD");
  const actualUser = String(username || "").trim().toLowerCase();
  const actualPassword = String(password || "");
  if (!expectedUser || !expectedPassword) return false;
  const left = Buffer.from(`${actualUser}\0${actualPassword}`);
  const right = Buffer.from(`${expectedUser}\0${expectedPassword}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const missing = ["REPORT_SYNC_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD"]
    .filter((name) => !envText(env, name));
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
}
```

Update the API to call `reportSyncKey()` and `adminCredentialsValid()`. Tests must set `REPORT_SYNC_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` before importing the handler. Update the admin UI so the submitted username/password are retained in `sessionStorage`, supplied to admin API calls, and never replaced by literals. Remove the default-account hint and remove the `env.REPORT_SYNC_KEY` block from `vercel.json`.

- [ ] **Step 4: Run focused security tests**

Run: `node --test test/runtime-config.test.mjs test/workbench-ui.test.mjs test/department-api.test.mjs test/persistence-api.test.mjs test/report-api.test.mjs`

Expected: PASS; `rg -n "DP-WEEKLY-2026-7K4M|888888" api public vercel.json` returns no matches.

- [ ] **Step 5: Commit the security boundary**

```powershell
git add -- lib/runtime-config.mjs 'api/[...path].mjs' public/index.html vercel.json test/runtime-config.test.mjs test/workbench-ui.test.mjs test/department-api.test.mjs test/persistence-api.test.mjs test/report-api.test.mjs
git commit -m "Secure production credentials"
```

### Task 2: Add durable CloudBase state storage

**Files:**
- Create: `lib/state-store.mjs`
- Modify: `api/[...path].mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/state-store.test.mjs`

- [ ] **Step 1: Write failing provider tests**

```js
test("CloudBase store round-trips the state document", async () => {
  const records = new Map();
  const collection = fakeCollection(records);
  const store = createStateStore({
    env: { CLOUDBASE_ENV_ID: "env-test" },
    cloudbaseDatabase: fakeDatabase(collection),
  });
  await store.save({ users: { alice: { username: "alice" } } });
  assert.deepEqual(await store.load(), { users: { alice: { username: "alice" } } });
});

test("production never falls back to temporary disk", async () => {
  const store = createStateStore({ env: { NODE_ENV: "production" } });
  await assert.rejects(() => store.save({}), /durable state storage is not configured/i);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/state-store.test.mjs`

Expected: FAIL because `createStateStore` does not exist.

- [ ] **Step 3: Implement the storage adapter**

Export `createStateStore({ env, cloudbaseDatabase, netlifyStore, vercelBlob })` with this provider order:

1. `CLOUDBASE_ENV_ID` or `TCB_ENV` → collection `workbench_state`, document `state-v1`.
2. Netlify runtime → existing strong-consistency store.
3. Vercel Blob token → existing private Blob object.
4. Non-production tests/local development → temporary file.
5. Production with no durable provider → throw before writing.

Use a CloudBase document shape that keeps metadata outside the payload:

```js
{
  _id: "state-v1",
  schemaVersion: 1,
  updatedAt: Date.now(),
  payload: state,
}
```

Initialize the SDK synchronously after dynamic import:

```js
const { default: cloudbase } = await import("@cloudbase/node-sdk");
const app = cloudbase.init({ env: env.CLOUDBASE_ENV_ID || env.TCB_ENV });
const db = app.database();
```

Keep hydration in the API layer: raw state loads from the adapter, then `hydrateState(raw)` runs exactly once.

- [ ] **Step 4: Install the server SDK and run tests**

Run: `npm.cmd install @cloudbase/node-sdk@latest`

Run: `node --test test/state-store.test.mjs test/persistence-api.test.mjs`

Expected: PASS, and production storage without CloudBase/Netlify/Vercel rejects instead of writing to `%TEMP%`.

- [ ] **Step 5: Commit durable storage**

```powershell
git add -- lib/state-store.mjs 'api/[...path].mjs' package.json package-lock.json test/state-store.test.mjs test/persistence-api.test.mjs
git commit -m "Persist workbench state in CloudBase"
```

### Task 3: Add the same-origin production server

**Files:**
- Create: `server.mjs`
- Test: `test/production-server.test.mjs`

- [ ] **Step 1: Write failing HTTP tests**

```js
test("production server serves health, UI, and protected API", async () => {
  const server = createProductionServer({ deploymentVersion: "test-version" });
  await listen(server, 0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${origin}/healthz`).then((res) => res.json());
  assert.equal(health.status, "ok");
  assert.equal(health.version, "test-version");
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/api/weeks`, {
    headers: { "x-report-key": process.env.REPORT_SYNC_KEY },
  })).status, 401);
  await close(server);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/production-server.test.mjs`

Expected: FAIL because `server.mjs` does not exist.

- [ ] **Step 3: Implement the server**

`createProductionServer()` must:

- call `validateProductionConfig()` before accepting production traffic;
- map `/api/<path>` to `req.query.path` and add `res.status().json()` compatibility;
- serve only files resolved inside `public`;
- return `public/index.html` for `/admin` and `/admin/*`;
- set `Cache-Control: no-store` for HTML and health, and long immutable caching only for fingerprinted assets;
- return `{ status: "ok", version: process.env.DEPLOYMENT_VERSION || "local" }` from `/healthz`;
- listen on `0.0.0.0` and `Number(process.env.PORT || 3000)` when run directly.

- [ ] **Step 4: Run server and API tests**

Run: `node --test test/production-server.test.mjs test/department-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the production server**

```powershell
git add -- server.mjs test/production-server.test.mjs
git commit -m "Add production workbench server"
```

### Task 4: Add a reproducible production build

**Files:**
- Create: `scripts/build.mjs`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `test/production-build.test.mjs`

- [ ] **Step 1: Write the failing artifact test**

```js
test("production build contains the runnable service", async () => {
  await runBuild();
  for (const file of ["server.mjs", "package.json", "public/index.html", "api/[...path].mjs"])
    await access(join("build", file));
  const manifest = JSON.parse(await readFile("build/build-manifest.json", "utf8"));
  assert.match(manifest.version, /^[0-9a-f]{7,40}$/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/production-build.test.mjs`

Expected: FAIL because the build script and artifact do not exist.

- [ ] **Step 3: Implement the build and container**

The build script recreates `build`, copies `server.mjs`, `api`, `lib`, `public`, `package.json`, and `package-lock.json`, and writes:

```json
{
  "version": "3cc049d476a8a4a89da1e1e875574a4d660961da",
  "builtAt": "2026-07-22T08:00:00.000Z"
}
```

The values above illustrate the schema. At build time, `version` is read from `git rev-parse HEAD` and `builtAt` is generated with `new Date().toISOString()`.

Add scripts:

```json
{
  "scripts": {
    "test": "node --test",
    "build": "node scripts/build.mjs",
    "start": "node server.mjs"
  }
}
```

The Dockerfile uses `node:22-alpine`, runs `npm ci --omit=dev`, copies the build artifact, exposes port 3000, and starts `node server.mjs`. `.dockerignore` excludes `.git`, `.env*`, `node_modules`, backups, test output, and local logs.

- [ ] **Step 4: Run production build tests**

Run: `npm.cmd run build`

Run: `node --test test/production-build.test.mjs test/production-server.test.mjs`

Expected: PASS and `build/build-manifest.json` contains the current commit SHA.

- [ ] **Step 5: Commit the build pipeline**

```powershell
git add -- scripts/build.mjs Dockerfile .dockerignore package.json .gitignore test/production-build.test.mjs
git commit -m "Add CloudBase production build"
```

### Task 5: Add verified migration tools

**Files:**
- Modify: `scripts/recover-blob-state.mjs`
- Create: `scripts/import-cloudbase-state.mjs`
- Create: `lib/state-fingerprint.mjs`
- Modify: `.gitignore`
- Test: `test/migration-tools.test.mjs`

- [ ] **Step 1: Write failing fingerprint tests**

```js
test("state fingerprint is stable and summarizes all migrated entities", () => {
  const state = { users: { a: {} }, sessions: { s: {} }, weeks: { w: {} }, tasks: { t: {} }, reports: { r: {} }, goalsByDepartment: { d: { rows: [1, 2] } }, settings: { departments: [{ id: "d" }] } };
  const first = fingerprintState(state);
  const second = fingerprintState(JSON.parse(JSON.stringify(state)));
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.counts, { users: 1, sessions: 1, weeks: 1, tasks: 1, reports: 1, goalRows: 2, departments: 1 });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/migration-tools.test.mjs`

Expected: FAIL because `fingerprintState` does not exist.

- [ ] **Step 3: Implement deterministic export and import**

`fingerprintState()` recursively sorts object keys before JSON serialization, then returns byte length, SHA-256, and entity counts. The export script accepts `MIGRATION_ENV_FILE` and `MIGRATION_BACKUP_DIR`, never logs secrets, and writes both `state-v1.json` and `state-v1.metadata.json`.

The import script:

1. reads both files;
2. verifies the source fingerprint;
3. writes the `workbench_state/state-v1` document using CloudBase server credentials;
4. reads it back;
5. fingerprints `payload` and exits nonzero on any mismatch.

Add `.env.migration*` and `backups/migration/` to `.gitignore`.

- [ ] **Step 4: Run migration tests**

Run: `node --test test/migration-tools.test.mjs`

Expected: PASS for stable fingerprints, corrupt metadata rejection, and import read-back mismatch rejection.

- [ ] **Step 5: Commit migration tooling**

```powershell
git add -- scripts/recover-blob-state.mjs scripts/import-cloudbase-state.mjs lib/state-fingerprint.mjs .gitignore test/migration-tools.test.mjs
git commit -m "Add verified production migration tools"
```

### Task 6: Run the release safety gate

**Files:**
- Modify only if a check exposes a real defect in an in-scope file.

- [ ] **Step 1: Verify repository scope and secrets**

Run: `git status -sb`

Run: `git grep -n -I -E '(AKID[A-Za-z0-9]{12,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|DP-WEEKLY-2026-7K4M|888888)' -- . ':!package-lock.json'`

Expected: clean intended scope and no credential matches.

- [ ] **Step 2: Audit production dependencies**

Run: `npm.cmd audit --omit=dev --audit-level=high`

Expected: zero high or critical vulnerabilities.

- [ ] **Step 3: Run all tests and build**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Run: `git diff --check`

Expected: all tests pass, build succeeds, and no whitespace errors.

- [ ] **Step 4: Run the built service locally**

Start `build/server.mjs` with production variables and an ephemeral port, then request `/healthz`, `/`, `/favicon.svg`, `/admin`, and `/api/weeks` without a login token.

Expected: health/UI/assets/admin return 200; protected API returns 401; no server error is logged.

- [ ] **Step 5: Commit any safety-gate fixes**

If no fixes were needed, do not create an empty commit. Otherwise stage only the corrected files and commit `Fix production release checks`.

### Task 7: Freeze and migrate Vercel production state

**Files:**
- Local ignored files only: `.env.migration.production`, a UTC timestamp-named directory under `backups/migration/`, `state-v1.json`, and its metadata file.

- [ ] **Step 1: Authenticate and link the Vercel source**

Run: `npx.cmd vercel@latest login`

Run: `npx.cmd vercel@latest link --yes --project deploy-weekly-report --scope zhongnh`

Run: `npx.cmd vercel@latest env pull .env.migration.production --environment=production --yes`

Expected: project `deploy-weekly-report` is linked and the ignored environment file exists without being printed.

- [ ] **Step 2: Begin the approved write-freeze window**

Record the UTC start time. Confirm the Vercel production deployment remains READY and avoid all API mutations against the old site until cutover verification finishes.

- [ ] **Step 3: Export and fingerprint the Blob state**

Run with `MIGRATION_ENV_FILE=.env.migration.production` and a timestamped `MIGRATION_BACKUP_DIR`, then execute `node scripts/recover-blob-state.mjs`.

Expected: state and metadata files exist; JSON parses; counts and SHA-256 are printed without secrets.

- [ ] **Step 4: Create the server-only CloudBase collection**

Create `workbench_state` in environment `shayen-d0g1qu7hfe1045db1` if absent. Set its client security rule to deny direct reads and writes. Obtain temporary CloudBase credentials through `auth(action="get_temp_credentials", reveal=true)` only for the import process.

- [ ] **Step 5: Import and read back**

Run `node scripts/import-cloudbase-state.mjs` with the backup paths, environment ID, and temporary CloudBase credentials supplied only through process environment variables.

Expected: source and destination SHA-256, byte length, and entity counts match exactly.

- [ ] **Step 6: Recheck source stability and remove credentials**

Query Vercel Blob metadata again. If size or `uploadedAt` changed, repeat export and import. Delete `.env.migration.production` after a stable match; retain the ignored JSON backup for rollback.

### Task 8: Deploy and verify the real CloudBase service

**Files:**
- No source changes unless deployment logs identify an in-scope defect.

- [ ] **Step 1: Prepare production environment variables**

Generate a new high-entropy `REPORT_SYNC_KEY` and `ADMIN_PASSWORD`, use `admin` as `ADMIN_USERNAME`, preserve existing AI provider keys only when present in Vercel production, and set:

```text
NODE_ENV=production
CLOUDBASE_ENV_ID=shayen-d0g1qu7hfe1045db1
DEPLOYMENT_VERSION is the exact output of git rev-parse HEAD
REPORT_SYNC_KEY is a newly generated 32-byte random value encoded as base64url
ADMIN_USERNAME=admin
ADMIN_PASSWORD is a newly generated 24-byte random value encoded as base64url
```

Do not write the values to source files or logs.

- [ ] **Step 2: Deploy CloudBase Run**

Deploy service `department-workbench` from the absolute project path as a container with `Dockerfile`, 0.25 CPU, 0.5 GB memory, minimum 0, maximum 3, port 3000, and public Web access. If the platform rejects the minimum resource pair, retry once with the smallest supported 1:2 CPU-memory pair.

Expected: deployment returns a build/version ID.

- [ ] **Step 3: Poll actual deployment status**

Use `queryCloudRun(action="detail", detailServerName="department-workbench")` until the latest revision is READY or a terminal failure occurs. On failure, query `getDeployLog`, fix only the reported issue, rerun tests/build, and redeploy.

- [ ] **Step 4: Verify the public URL**

Request the actual CloudBase public URL and verify:

- `/healthz` returns 200 and the deployed Git SHA;
- `/` returns 200 and contains `<title>部门工作台</title>`;
- `/favicon.svg` returns 200 with an SVG content type;
- `/admin` returns 200;
- `/api/weeks` with the sync key but without a user token returns 401;
- `/api/settings` does not expose member accounts to an anonymous request;
- an existing migrated Vercel user can log in and read its department data;
- migrated counts observed through authenticated APIs agree with the source summary.

- [ ] **Step 5: Inspect cloud logs and finish the cutover**

Query the latest CloudBase Run deployment logs and runtime status. Expected: no startup failure, database connection error, unhandled exception, or repeated 5xx. Record freeze end time and keep Vercel deployment and Blob untouched for rollback.

- [ ] **Step 6: Commit and publish deployment adaptations**

Run the full test/build gate once more, push the current branch, and update the existing GitHub PR with the Tencent Cloud migration commits. Do not commit ignored migration credentials or backups.

- [ ] **Step 7: Report the deployment**

Return the CloudBase environment, service, region, deployed Git SHA/build ID, actual cloud status, migration fingerprint/count summary, verified public link, and Vercel rollback-retention status.
