import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkerClient, defaultWorkerRoot } from "./report-worker.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const q = (value) => String(value).replaceAll('"', '""');

async function save(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

export async function installReportWorker({ connectionPath, destination = defaultWorkerRoot, startup = true } = {}) {
  if (!connectionPath) throw new Error("请指定后台下载的连接配置文件");
  const config = JSON.parse(await readFile(resolve(connectionPath), "utf8"));
  createWorkerClient(config);
  await mkdir(destination, { recursive: true });
  await Promise.all([
    cp(join(root, "scripts", "report-worker.mjs"), join(destination, "report-worker.mjs")),
    cp(join(root, "lib", "period-report-engine.mjs"), join(destination, "period-report-engine.mjs")),
    cp(join(root, "lib", "period-report-service.mjs"), join(destination, "period-report-service.mjs")),
  ]);
  const localConfig = { ...config, workDir: join(destination, "runs") };
  await save(join(destination, "connection.json"), `${JSON.stringify(localConfig, null, 2)}\n`);
  await save(join(destination, "package.json"), '{"private":true,"type":"module"}\n');
  const launcher = join(destination, "run-report-worker.vbs");
  await save(
    launcher,
    `Set shell = CreateObject("WScript.Shell")\nshell.Run """${q(process.execPath)}"" ""${q(join(destination, "report-worker.mjs"))}"" --config ""${q(join(destination, "connection.json"))}""", 0, False\n`,
  );
  if (startup && process.platform === "win32") {
    await execFileAsync("schtasks.exe", ["/Create", "/TN", "Department Workbench Report Worker", "/TR", `wscript.exe "${launcher}"`, "/SC", "ONLOGON", "/RL", "LIMITED", "/F"], { windowsHide: true });
  }
  const child = spawn(process.execPath, [join(destination, "report-worker.mjs"), "--config", join(destination, "connection.json")], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { destination, startupInstalled: Boolean(startup && process.platform === "win32") };
}

async function main() {
  const args = process.argv.slice(2);
  const configAt = args.indexOf("--config");
  const result = await installReportWorker({ connectionPath: configAt >= 0 ? args[configAt + 1] : "", startup: !args.includes("--no-startup") });
  console.log(`本机报告程序已安装：${result.destination}`);
  if (result.startupInstalled) console.log("已设置登录后自动运行。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
