import { timingSafeEqual } from "node:crypto";

function envText(env, name) {
  return String(env[name] || "").trim();
}

function safeTextEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function adminCredentialsValid(username, password, env = process.env) {
  const expectedUser = envText(env, "ADMIN_USERNAME").toLowerCase();
  const expectedPassword = envText(env, "ADMIN_PASSWORD");
  const actualUser = String(username || "")
    .trim()
    .toLowerCase();
  return (
    Boolean(expectedUser && expectedPassword) &&
    safeTextEqual(`${actualUser}\0${password || ""}`, `${expectedUser}\0${expectedPassword}`)
  );
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const required = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];
  const missing = required.filter((name) => !envText(env, name));
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
}
