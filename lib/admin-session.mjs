import { createHmac, timingSafeEqual } from "node:crypto";

const defaultTtlMs = 30 * 60_000;

function signingSecret(env) {
  const secret = String(env?.ADMIN_SESSION_SECRET || "");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload, env) {
  return createHmac("sha256", signingSecret(env)).update(payload).digest("base64url");
}

function signaturesMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function issueAdminToken({ username, role = "admin", now = Date.now(), ttlMs = defaultTtlMs, env = process.env }) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedRole = role === "leader" ? "leader" : "admin";
  const expiresAt = now + ttlMs;
  const payload = encode(JSON.stringify({ username: normalizedUsername, role: normalizedRole, issuedAt: now, expiresAt }));
  return { token: `${payload}.${signature(payload, env)}`, expiresAt };
}

export async function verifyAdminToken(token, { now = Date.now(), env = process.env } = {}) {
  try {
    const [payload, actualSignature, extra] = String(token || "").split(".");
    if (!payload || !actualSignature || extra) return null;
    if (!signaturesMatch(actualSignature, signature(payload, env))) return null;
    const decoded = JSON.parse(decode(payload));
    if (!decoded.username || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= now) return null;
    return { ...decoded, role: decoded.role === "leader" ? "leader" : "admin" };
  } catch {
    return null;
  }
}
