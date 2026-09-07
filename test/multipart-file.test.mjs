import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { parseSingleFile } from "../lib/multipart-file.mjs";

function multipartRequest(files, boundary = "artifact-boundary") {
  const parts = files.map(
    ({ field = "file", filename, mimeType, content }) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n`,
  );
  const req = Readable.from(Buffer.from(`${parts.join("")}--${boundary}--\r\n`));
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

test("parses one named file and preserves a UTF-8 filename", async () => {
  const file = await parseSingleFile(
    multipartRequest([
      {
        filename: "结果.pdf",
        mimeType: "application/pdf",
        content: "%PDF-1.7",
      },
    ]),
  );
  assert.equal(file.filename, "结果.pdf");
  assert.equal(file.mimeType, "application/pdf");
  assert.match(file.buffer.toString(), /^%PDF/);
});

test("rejects missing and multiple file parts", async () => {
  await assert.rejects(() => parseSingleFile(multipartRequest([])), /请选择产物文件/);
  await assert.rejects(
    () =>
      parseSingleFile(
        multipartRequest([
          { filename: "a.pdf", mimeType: "application/pdf", content: "%PDF-a" },
          { filename: "b.pdf", mimeType: "application/pdf", content: "%PDF-b" },
        ]),
      ),
    /只能上传一个/,
  );
});

test("rejects a file when the stream crosses the configured limit", async () => {
  await assert.rejects(
    () =>
      parseSingleFile(
        multipartRequest([
          {
            filename: "large.pdf",
            mimeType: "application/pdf",
            content: "%PDF-too-large",
          },
        ]),
        { maxBytes: 4 },
      ),
    (error) => error.statusCode === 413 && /20 MB/.test(error.message),
  );
});
