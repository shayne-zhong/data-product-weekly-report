import test from "node:test";
import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { convertOfficeToPdf } from "../lib/artifact-preview.mjs";

test("converts an Office buffer to PDF and removes its temporary directory", async () => {
  let captured;
  const run = async (executable, args, options) => {
    captured = { executable, args, options };
    const outDir = args[args.indexOf("--outdir") + 1];
    await writeFile(path.join(outDir, "source.pdf"), Buffer.from("%PDF-preview"));
  };

  const pdf = await convertOfficeToPdf({
    buffer: Buffer.from("office"),
    extension: ".pptx",
    executable: "soffice-test",
    run,
  });

  assert.equal(pdf.toString(), "%PDF-preview");
  assert.equal(captured.executable, "soffice-test");
  assert.deepEqual(captured.args.slice(0, 3), ["--headless", "--convert-to", "pdf"]);
  assert.equal(captured.options.timeout, 30_000);
  const outDir = captured.args[captured.args.indexOf("--outdir") + 1];
  await assert.rejects(
    () => access(outDir),
    (error) => error.code === "ENOENT",
  );
});

test("maps a missing executable to an actionable LibreOffice error", async () => {
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  await assert.rejects(
    () =>
      convertOfficeToPdf({
        buffer: Buffer.from("office"),
        extension: ".docx",
        run: async () => {
          throw missing;
        },
      }),
    (error) => error.statusCode === 503 && /未找到 LibreOffice/.test(error.message),
  );
});

test("rejects timeout and invalid conversion output without leaking internals", async () => {
  const timedOut = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
  await assert.rejects(
    () =>
      convertOfficeToPdf({
        buffer: Buffer.from("office"),
        extension: ".xlsx",
        run: async () => {
          throw timedOut;
        },
      }),
    (error) => error.statusCode === 504 && /超时/.test(error.message),
  );

  await assert.rejects(
    () =>
      convertOfficeToPdf({
        buffer: Buffer.from("office"),
        extension: ".pptx",
        run: async (_executable, args) => {
          const outDir = args[args.indexOf("--outdir") + 1];
          await writeFile(path.join(outDir, "source.pdf"), Buffer.from("not-pdf"));
        },
      }),
    (error) => error.statusCode === 422 && /预览转换失败/.test(error.message),
  );
});
