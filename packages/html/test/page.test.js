import { test } from "node:test";
import assert from "node:assert/strict";
import { IsrPage, h, page } from "../dist/esm/index.js";

test("page wraps head and body in a full document", () => {
  const out = page(h("title", [], ["Hi"]), h("h1", [], ["Hello"]));
  assert.equal(
    out,
    "<!doctype html><html><head><title>Hi</title></head><body><h1>Hello</h1></body></html>",
  );
});

test("page emits empty head/body when passed empty strings", () => {
  assert.equal(page("", ""), "<!doctype html><html><head></head><body></body></html>");
});

test("page does not escape head or body (they are markup)", () => {
  const out = page('<meta charset="utf-8"/>', "<p>x</p>");
  assert.ok(out.includes('<meta charset="utf-8"/>'));
  assert.ok(out.includes("<p>x</p>"));
});

test("IsrPage renders once and serves the cached string", () => {
  let renders = 0;
  const p = new IsrPage(() => {
    renders++;
    return "r" + renders;
  }, 60);
  assert.equal(renders, 1);
  assert.equal(p.html(), "r1");
  assert.equal(p.html(), "r1");
  assert.equal(renders, 1);
});

test("IsrPage re-renders after the revalidate window", async () => {
  let renders = 0;
  const p = new IsrPage(() => {
    renders++;
    return "r" + renders;
  }, 0.05);
  assert.equal(p.html(), "r1");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(p.html(), "r2");
  assert.equal(renders, 2);
  assert.equal(p.html(), "r2");
});

test("IsrPage freshUntil reports the next re-render instant", () => {
  const before = Date.now();
  const p = new IsrPage(() => "x", 30);
  assert.ok(p.freshUntil() >= before + 30000 - 50);
  assert.ok(p.freshUntil() <= Date.now() + 30000 + 50);
});
