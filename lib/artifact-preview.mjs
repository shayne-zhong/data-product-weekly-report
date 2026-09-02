import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { OFFICE_EXTENSIONS } from "./artifact-core.mjs";

const execFileAsync = promisify(execFile);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function defaultRun(executable, args, options) {
  return execFileAsync(executable, args, {
    ...options,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

export async function convertOfficeToPdf({
  buffer,
  extension,
  executable = process.env.LIBREOFFICE_BIN || (process.platform === "win32" ? "soffice.exe" : "soffice"),
  run = defaultRun,
} = {}) {
  const normalizedExtension = String(extension || "").toLowerCase();
  if (!OFFICE_EXTENSIONS.has(normalizedExtension)) throw httpError(400, "该文件不需要 Office 预览转换");

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "goal-artifact-preview-"));
  const sourcePath = path.join(temporaryDirectory, `source${normalizedExtension}`);
  const outputPath = path.join(temporaryDirectory, "source.pdf");
  try {
    await writeFile(sourcePath, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ""));
    await run(executable, ["--headless", "--convert-to", "pdf", "--outdir", temporaryDirectory, sourcePath], {
      timeout: 30_000,
    });
    const pdf = await readFile(outputPath);
    if (!pdf.length || pdf.subarray(0, 4).toString("ascii") !== "%PDF") throw httpError(422, "Office 预览转换失败");
    return pdf;
  } catch (error) {
    if (error?.statusCode) throw error;
    if (error?.code === "ENOENT") throw httpError(503, "未找到 LibreOffice，请安装后重试");
    if (error?.killed || error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM")
      throw httpError(504, "Office 预览转换超时");
    throw httpError(422, "Office 预览转换失败");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
