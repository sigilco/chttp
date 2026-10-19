// chttp + @chttp/html compile gate: `scriptc coverage bench/apps/chttp-html.ts` must stay 100% static.
// Exercises every export of the subset runtime.
import { createRouter } from "../../packages/router/src/index.ts";
import {
  BARE,
  Fragment,
  IsrPage,
  createElement,
  escapeHtml,
  h,
  html,
  isValidAttrName,
  isValidTag,
  isVoidElement,
  page,
  raw,
} from "../../packages/html/src/index.ts";

function Card(title: string, body: string): string {
  return h("section", ["class", "card"], [h("h2", [], [escapeHtml(title)]), body]);
}

const app = createRouter();

app.get("/page", (c) => {
  const q = c.req.query("q");
  const name = q === null ? "world" : q;
  const pageMarkup = Fragment([
    h("meta", ["charset", "utf-8"], []),
    Card("hi " + name, html`<p>${name}</p>`),
    createElement("input", ["disabled", BARE, "value", name]),
    raw`<hr/>`,
    h("div", ["safe", "true"], ["<b>" + name + "</b>"]),
  ]);
  const ok = isValidTag("div") && isValidAttrName("data-x") && isVoidElement("br");
  return c.html(ok ? pageMarkup : "");
});

const index = new IsrPage(
  () => page(h("title", [], ["home"]), Card("isr", html`<p>cached</p>`)),
  30,
);

app.get("/isr", (c) => c.html(index.html() + index.freshUntil()));

app.serve({ port: Number(process.argv[2] || 3000) });
