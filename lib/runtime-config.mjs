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
  const actualUser = String(username || "").trim().toLowerCase();
  return Boolean(expectedUser && expectedPassword)
    && safeTextEqual(`${actualUser}\0${password || ""}`, `${expectedUser}\0${expectedPassword}`);
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const required = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];
  // Container-based CloudRun does not auto-inject DB credentials; CLOUDBASE_APIKEY
  // is needed for state persistence. Warn instead of crashing so the service can
  // start, but the admin must add the key in CloudBase console for full function.
  if (!envText(env, "CLOUDBASE_APIKEY")) {
    console.error("WARNING: CLOUDBASE_APIKEY is not set. State will not persist across container instances. Add it in CloudBase console → 环境变量.");
  }
  const missing = required.filter((name) => !envText(env, name));
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
}
