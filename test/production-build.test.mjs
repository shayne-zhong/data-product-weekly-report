import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);

test("production build contains the runnable service", async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: root });

  for (const file of ["server.mjs", "package.json", "package-lock.json", "public/index.html", "api/[...path].mjs"]) {
    await access(new URL(`../build/${file}`, import.meta.url));
  }

  const manifest = JSON.parse(await readFile(new URL("../build/build-manifest.json", import.meta.url), "utf8"));
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  assert.equal(manifest.version, stdout.trim());
  assert.match(manifest.builtAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(join("build", manifest.entry), join("build", "server.mjs"));
});

test("production build uses Vercel commit metadata without requiring a Git checkout", async () => {
  const commit = "1234567890abcdef1234567890abcdef12345678";
  await execFileAsync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    env: { ...process.env, VERCEL_GIT_COMMIT_SHA: commit },
  });

  const manifest = JSON.parse(await readFile(new URL("../build/build-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, commit);
});

test("production build has a safe version fallback for manual uploads", async () => {
  const source = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(source, /catch\s*\{[\s\S]*version = "manual-upload"/);
});
