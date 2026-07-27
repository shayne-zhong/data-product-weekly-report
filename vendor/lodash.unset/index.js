"use strict";

const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

function pathParts(path) {
  if (Array.isArray(path)) return path.map(String);
  return String(path)
    .replace(/\[["']?([^"'\]]+)["']?\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

module.exports = function unset(object, path) {
  const parts = pathParts(path);
  if (!object || parts.some((part) => blockedKeys.has(part))) return true;
  let target = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target = target?.[parts[index]];
    if (!target || typeof target !== "object") return true;
  }
  return parts.length ? delete target[parts.at(-1)] : true;
};
