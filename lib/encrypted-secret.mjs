import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(env) {
  const encoded = String(env?.SETTINGS_ENCRYPTION_KEY || "").trim();
  if (!encoded) throw new Error("SETTINGS_ENCRYPTION_KEY is required to store AI API keys");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32 bytes key");
  }
  return key;
}

export async function encryptSecret(secret, { env = process.env } = {}) {
  const value = String(secret || "");
  if (!value) throw new Error("Secret cannot be empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function decryptSecret(record, { env = process.env } = {}) {
  if (record?.version !== 1 || record?.algorithm !== "AES-256-GCM") {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(String(record.iv || ""), "base64"),
  );
  decipher.setAuthTag(Buffer.from(String(record.authTag || ""), "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(String(record.ciphertext || ""), "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(secret) {
  const value = String(secret || "");
  return value ? `•••• ${value.slice(-4).padStart(4, "•")}` : "";
}
