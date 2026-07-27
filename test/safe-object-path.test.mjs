import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const set = require("lodash.set");
const unset = require("lodash.unset");

test("CloudBase object-path helpers reject prototype pollution paths", () => {
  delete Object.prototype.polluted;

  set({}, "__proto__.polluted", "yes");
  assert.equal(Object.prototype.polluted, undefined);

  unset({}, "__proto__.polluted");
  assert.equal(Object.prototype.polluted, undefined);
});

test("CloudBase object-path helpers preserve normal nested updates", () => {
  const value = {};

  set(value, "report.owner.name", "Alice");
  assert.deepEqual(value, { report: { owner: { name: "Alice" } } });

  unset(value, "report.owner.name");
  assert.deepEqual(value, { report: { owner: {} } });
});
