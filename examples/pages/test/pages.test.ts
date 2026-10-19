import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";

async function serve(app: ReturnType<typeof buildApp>) {
  const server = app.serve({ port: 0 });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  return { server, url: "http://127.0.0.1:" + port };
}

test("index is a full document rendered once (SSG)", async () => {
  const { server, url } = await serve(buildApp(60));
  const a = await (await fetch(url + "/")).text();
  const b = await (await fetch(url + "/")).text();
  server.close();
  assert.ok(a.startsWith("<!doctype html>"));
  assert.ok(a.includes('<a href="/post/hello">Hello, pages</a>'));
  assert.equal(a, b);
});

test("post page is cached inside the revalidate window, re-rendered after (ISR)", async () => {
  const { server, url } = await serve(buildApp(0.05));
  const one = await (await fetch(url + "/post/isr")).text();
  assert.ok(one.includes("render 1"));
  const two = await (await fetch(url + "/post/isr")).text();
  assert.equal(two, one);
  await new Promise((r) => setTimeout(r, 60));
  const three = await (await fetch(url + "/post/isr")).text();
  server.close();
  assert.ok(three.includes("render 2"));
});

test("unknown slug renders a 404 page", async () => {
  const { server, url } = await serve(buildApp(60));
  const res = await fetch(url + "/post/nope");
  server.close();
  assert.equal(res.status, 404);
  assert.ok((await res.text()).includes("no such post"));
});
