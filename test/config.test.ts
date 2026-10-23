import assert from "node:assert/strict";
import test from "node:test";

import { resolvePort } from "../src/server/config.js";

test("defaults to port 3000 when PORT is undefined", () => {
  assert.equal(resolvePort(undefined), 3000);
});

test("defaults to port 3000 when PORT is empty", () => {
  assert.equal(resolvePort(""), 3000);
});

test("uses the port from PORT", () => {
  assert.equal(resolvePort("4000"), 4000);
});

test("accepts port 0 for an ephemeral port", () => {
  assert.equal(resolvePort("0"), 0);
});

test("rejects a non-numeric PORT", () => {
  assert.throws(() => resolvePort("abc"), {
    message: 'Invalid PORT "abc": expected an integer from 0 to 65535.',
  });
});

test("rejects a negative PORT", () => {
  assert.throws(() => resolvePort("-1"), {
    message: 'Invalid PORT "-1": expected an integer from 0 to 65535.',
  });
});

test("rejects a PORT above 65535", () => {
  assert.throws(() => resolvePort("65536"), {
    message: 'Invalid PORT "65536": expected an integer from 0 to 65535.',
  });
});

test("rejects a non-integer PORT", () => {
  assert.throws(() => resolvePort("12.5"), {
    message: 'Invalid PORT "12.5": expected an integer from 0 to 65535.',
  });
});
