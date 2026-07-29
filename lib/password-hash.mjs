import { createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const legacyAlgorithm = "sha256";
const currentAlgorithm = "scrypt";
const scryptKeylen = 64;
const scryptParams = { N: 16384, r: 8, p: 1 };

function legacySha256Hash(password, salt) {
  return createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
}

async function scryptHash(password, salt) {
  const derivedKey = await scrypt(password, salt, scryptKeylen, scryptParams);
  return derivedKey.toString("hex");
}

function timingSafeStringEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function hashPassword(password, salt) {
  return { hashAlgorithm: currentAlgorithm, passwordHash: await scryptHash(password, salt) };
}

export async function verifyPassword(password, user) {
  const hashAlgorithm = user?.hashAlgorithm === currentAlgorithm ? currentAlgorithm : legacyAlgorithm;
  const candidateHash =
    hashAlgorithm === legacyAlgorithm ? legacySha256Hash(password, user?.salt) : await scryptHash(password, user?.salt);
  return timingSafeStringEqual(candidateHash, user?.passwordHash);
}

export function needsRehash(user) {
  return user?.hashAlgorithm !== currentAlgorithm;
}
