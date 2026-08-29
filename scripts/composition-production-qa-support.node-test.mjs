import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStaticRequestPath } from "./composition-production-qa.mjs";

const dist = resolve("dist");

test("composition static resolver maps root-base requests inside dist", () => {
  assert.equal(resolveStaticRequestPath(dist, "/", "/"), join(dist, "index.html"));
  assert.equal(resolveStaticRequestPath(dist, "/assets/index.js", "/"), join(dist, "assets", "index.js"));
});

test("composition static resolver strips the Pages repository base", () => {
  const base = "/workhub-goal-room/";
  assert.equal(resolveStaticRequestPath(dist, base, base), join(dist, "index.html"));
  assert.equal(
    resolveStaticRequestPath(dist, `${base}assets/index.js`, base),
    join(dist, "assets", "index.js"),
    "a Pages-prefixed built asset request must resolve to the emitted dist asset",
  );
});

test("composition static resolver rejects traversal and requests outside the configured base", () => {
  assert.equal(resolveStaticRequestPath(dist, "/../secret", "/"), null);
  assert.equal(resolveStaticRequestPath(dist, "/assets/index.js", "/workhub-goal-room/"), null);
});
