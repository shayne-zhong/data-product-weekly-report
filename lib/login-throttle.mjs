export const maxLoginAttempts = 5;
export const loginLockoutMs = 15 * 60_000;

export function loginThrottleStatus(bucket, key, now = Date.now()) {
  const entry = bucket?.[key];
  if (entry?.lockedUntil && entry.lockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }
  return { allowed: true };
}

export function registerLoginFailure(bucket, key, now = Date.now()) {
  const entry = bucket[key];
  const stillLocked = Boolean(entry?.lockedUntil && entry.lockedUntil > now);
  const count = stillLocked ? entry.count : (entry?.count || 0) + 1;
  bucket[key] = count >= maxLoginAttempts ? { count: 0, lockedUntil: now + loginLockoutMs } : { count, lockedUntil: 0 };
}

export function clearLoginFailures(bucket, key) {
  delete bucket[key];
}
