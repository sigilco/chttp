# HTML rendering

`@chttp/html` renders HTML strings inside the scriptc compilable subset, so server side rendering works in a compiled chttp binary. It is independent of `@chttp/router`: it only produces strings you hand to `c.html(...)`. Names follow [kitajs/html](https://github.com/kitajs/html) where the subset allows; the audit is in `.agents/notes/2026-10-14-kitajs-api-audit.md`.

## API

| Export                                           | Signature                                                          | Notes                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `escapeHtml`                                     | `(s: string) => string`                                            | Escapes `& < " '` to `&amp; &lt; &#34; &#39;`, same bytes as kitajs. Charcode loop, no regex |
| `h`                                              | `(tag: string, attrs: string[], kids: string[]) => string`         | `attrs` is a flat `[name, value, ...]` array. Void elements self close                       |
| `createElement`                                  | `(name: string, attrs: string[], ...children: string[]) => string` | kitajs shaped alias of `h`                                                                   |
| `Fragment`                                       | `(kids: string[]) => string`                                       | Siblings without a wrapper                                                                   |
| `html`                                           | tagged template                                                    | Escapes interpolations, static text is trusted markup                                        |
| `raw`                                            | tagged template                                                    | No escaping, for composing already rendered markup                                           |
| `BARE`                                           | `string`                                                           | Attribute value sentinel for bare boolean attributes                                         |
| `isVoidElement`, `isValidTag`, `isValidAttrName` | `(s: string) => boolean`                                           | Exposed helpers                                                                              |

```ts
import { BARE, escapeHtml, h, html } from "@chttp/html";

function Todo(props: { text: string; done: boolean }): string {
  return h("li", ["class", props.done ? "done" : "open"], [escapeHtml(props.text)]);
}

app.get("/todos", (c) =>
  c.html(
    h("ul", [], [Todo({ text: "<b>ship</b>", done: false })]) +
      h("input", ["disabled", BARE, "value", "x"], []),
  ),
);
```

## Escaping model

Like kitajs, children are pre-rendered markup and are not escaped by `h`: a string child cannot be told apart from a nested element. Escape text yourself with `escapeHtml`, or write it with the `html` tag, which escapes every interpolation. A `safe` attribute pair escapes the joined children once (`h("p", ["safe", "true"], [userText])`) and is not emitted. Attribute values are always escaped. Tag and attribute names are validated and an invalid name throws, so a user controlled key cannot inject an attribute.

Differences from kitajs on purpose: the `html` tag escapes only interpolations (kitajs `escape` escapes the whole string, static text included), attribute values escape `&`, `<`, `"` and `'` (kitajs escapes only `"`), and there are no attribute objects, async children, or function typed element names.

## Escaping footguns

> **Warning:** `@chttp/html` is not auto escaping. Anything you pass as a string child is emitted as markup.
>
> - `h("p", [], [userText])` writes `userText` verbatim, so `<script>` in it executes. Wrap untrusted text in `escapeHtml(...)`, use the `html` tag, or add the `safe` attribute pair.
> - `safe` escapes all joined children, including nested elements you rendered with `h`, so do not mix trusted markup and `safe` in one parent.
> - Attribute escaping is not URL validation. `h("a", ["href", userUrl], [...])` happily emits `href="javascript:alert(1)"`. Check the scheme (allow `http:`, `https:`, `mailto:` or relative) before building the element.
> - `html` escapes interpolations only. Static template text and everything passed through `raw` are trusted. Interpolating the output of another `html` call escapes it a second time, so compose rendered fragments with `h`, `Fragment` or `raw`.
> - `escapeHtml` is not idempotent: `escapeHtml(escapeHtml("<"))` is `&amp;lt;`. Escape once, at the point you build the element.
> - `escapeHtml` is only correct for text nodes and quoted attribute values. It does nothing for unquoted attributes (always quoted here), `<script>` or `<style>` bodies, inline event handlers, or CSS and URL contexts.
> - The `BARE` sentinel is the single character `\u0000`. An untrusted value equal to it turns a valued attribute into a bare one.

Tag and attribute names are validated and throw, so they cannot be used for injection, but they are not escaped: never derive them from a lookup that can return an unvalidated string you intended as a value. These behaviors are pinned by the `footgun:` tests in `packages/html/test/html.test.js`.

## Namespace form

`import * as Html from "@chttp/html"` gives kitajs style call sites (`Html.escapeHtml`, `Html.createElement`, `Html.Fragment`). It lowers like `import * as v from "@chttp/val"`. A namespace object of functions would be a function-in-record, which the subset bans, so there is no default export.

## JSX in dev and tests

`@chttp/html/jsx-runtime` (and `jsx-dev-runtime`) export `jsx`, `jsxs`, `Fragment` and a `JSX` namespace so `"jsx": "react-jsx"` with `"jsxImportSource": "@chttp/html"` works under Node. Output is produced by `h()`, so it is byte identical to the same tree written with `h`. JSX props map to attrs (`className` to `class`, `true` to a bare attribute, `false`, `null` and `undefined` skipped, `safe` honoured). This runtime is not in the subset and must never be imported by code that compiles to the ELF. Production builds will lower `.tsx` to plain `h`/`html` calls at build time (planned unplugin `jsx` slice).

## Pages, SSG and ISR

`@chttp/html` also ships the page-level surface of issue #14's slice: a document
shell and a revalidate cache. Components stay plain `(props) => string`
functions; there is no component class, virtual DOM, or client runtime.

| Export               | Signature                                                      | Notes                                                                                      |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `page`               | `(head: string, body: string) => string`                       | Full document: `<!doctype html>` + `<html><head>` + `<body>`. Args are markup, not escaped |
| `IsrPage`            | `new IsrPage(render: () => string, revalidateSeconds: number)` | Caches `render()` output; re-renders on the first `html()` read after the window elapses   |
| `IsrPage.html`       | `() => string`                                                 | The cached document                                                                        |
| `IsrPage.freshUntil` | `() => number`                                                 | Epoch ms of the next re-render instant                                                     |

**SSG** needs no API: call your component once at startup and serve the baked
string from a route. **ISR** wraps a render function in `IsrPage` — revalidation
is synchronous (Next.js blocking-fallback semantics); the reader that hits an
expired window pays the render. There is no background refresh inside the
subset. See `examples/pages` for a working app.

```ts
const index = Layout("posts", PostList(POSTS)); // once — SSG
app.get("/", (c) => c.html(index));

const post = new IsrPage(() => Layout("post", PostCard(loadPost())), 60); // ISR
app.get("/post", (c) => c.html(post.html()));
```

This is a slice, not a framework: no per-request data loading, nested layouts,
streaming, islands/hydration, or build-time prerender yet — see issue #14 for
the remaining surface.

## Compile gate

`scriptc coverage bench/apps/chttp-html.ts` must report 100% static. `pnpm --filter @chttp/html test` runs the unit tests, the XSS payload cases, and the jsx-runtime equivalence test.
