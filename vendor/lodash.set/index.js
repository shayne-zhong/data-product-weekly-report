"use strict";

const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

function pathParts(path) {
  if (Array.isArray(path)) return path.map(String);
  return String(path)
    .replace(/\[["']?([^"'\]]+)["']?\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

module.exports = function set(object, path, value) {
  const parts = pathParts(path);
  if (!object || parts.some((part) => blockedKeys.has(part))) return object;
  let target = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const nextKey = parts[index + 1];
    if (!target[key] || typeof target[key] !== "object") {
      target[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    target = target[key];
  }
  if (parts.length) target[parts.at(-1)] = value;
  return object;
};
