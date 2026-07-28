import test from "node:test";
import assert from "node:assert/strict";

import {
  clearLoginFailures,
  loginThrottleStatus,
  maxLoginAttempts,
  registerLoginFailure,
} from "../lib/login-throttle.mjs";

test("allows attempts until the failure threshold, then locks out", () => {
  const bucket = {};
  const now = 1_000_000;

  for (let i = 0; i < maxLoginAttempts - 1; i += 1) {
    assert.equal(loginThrottleStatus(bucket, "user:a", now).allowed, true);
    registerLoginFailure(bucket, "user:a", now);
  }

  assert.equal(loginThrottleStatus(bucket, "user:a", now).allowed, true);
  registerLoginFailure(bucket, "user:a", now);

  const locked = loginThrottleStatus(bucket, "user:a", now);
  assert.equal(locked.allowed, false);
  assert.ok(locked.retryAfterMs > 0);
});

test("lockout expires after the window passes", () => {
  const bucket = {};
  const now = 1_000_000;
  for (let i = 0; i < maxLoginAttempts; i += 1) registerLoginFailure(bucket, "user:a", now);

  assert.equal(loginThrottleStatus(bucket, "user:a", now).allowed, false);
  const later = now + 20 * 60_000;
  assert.equal(loginThrottleStatus(bucket, "user:a", later).allowed, true);
});

test("a successful login clears the failure count", () => {
  const bucket = {};
  const now = 1_000_000;
  registerLoginFailure(bucket, "user:a", now);
  registerLoginFailure(bucket, "user:a", now);
  clearLoginFailures(bucket, "user:a");

  assert.equal(bucket["user:a"], undefined);
  assert.equal(loginThrottleStatus(bucket, "user:a", now).allowed, true);
});

test("failure counts for different keys never interfere with each other", () => {
  const bucket = {};
  const now = 1_000_000;
  for (let i = 0; i < maxLoginAttempts; i += 1) registerLoginFailure(bucket, "admin", now);

  assert.equal(loginThrottleStatus(bucket, "admin", now).allowed, false);
  assert.equal(loginThrottleStatus(bucket, "user:a", now).allowed, true);
});
