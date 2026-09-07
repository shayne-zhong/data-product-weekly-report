import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const output = join(root, "build");
const entries = ["server.mjs", "api", "lib", "public", "package.json", "package-lock.json"];

const html = await readFile(join(root, "public", "index.html"), "utf8");
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inlineScript) throw new Error("public/index.html is missing its inline application script");
new Function(inlineScript[1]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) {
  await cp(join(root, entry), join(output, entry), { recursive: true });
}

// Generate deployment Dockerfile with paths relative to build/ context
await writeFile(
  join(output, "Dockerfile"),
  `FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . ./

EXPOSE 3000
USER node

CMD ["node", "server.mjs"]
`,
  "utf8",
);

const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
const manifest = {
  version: stdout.trim(),
  builtAt: new Date().toISOString(),
  entry: "server.mjs",
};
await writeFile(join(output, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Production build ready: ${output} (${manifest.version.slice(0, 12)})`);
