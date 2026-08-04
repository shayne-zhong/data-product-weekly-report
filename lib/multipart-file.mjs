import busboy from "busboy";

import { MAX_ARTIFACT_BYTES } from "./artifact-core.mjs";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function parseSingleFile(req, { maxBytes = MAX_ARTIFACT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { files: 1, fields: 0, fileSize: maxBytes },
      });
    } catch {
      reject(httpError(400, "请使用文件上传格式"));
      return;
    }

    let result = null;
    let limited = false;
    let multiple = false;
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "file" || result) {
        stream.resume();
        return;
      }
      const chunks = [];
      stream.on("limit", () => {
        limited = true;
      });
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        result = {
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
        };
      });
    });
    parser.on("filesLimit", () => {
      multiple = true;
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      if (limited) return reject(httpError(413, "产物不能超过 20 MB"));
      if (multiple) return reject(httpError(400, "每次只能上传一个产物文件"));
      if (!result) return reject(httpError(400, "请选择产物文件"));
      resolve(result);
    });
    req.pipe(parser);
  });
}
