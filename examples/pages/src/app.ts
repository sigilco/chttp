// pages: server-side component rendering on chttp — SSG + ISR slice.
// Components are plain (props) => string functions returning markup from
// @chttp/html; the same source compiles to a native ELF via `pnpm build`.
import { IsrPage, escapeHtml, h, page } from "@chttp/html";
import { createRouter } from "@chttp/router";

interface Post {
  slug: string;
  title: string;
  body: string;
}

const POSTS: Post[] = [
  { slug: "hello", title: "Hello, pages", body: "Server-rendered once at startup." },
  { slug: "isr", title: "Incremental static", body: "Re-rendered after a TTL." },
];

// Layout wraps page(head, body): a full document, not a fragment.
function Layout(title: string, body: string): string {
  return page(
    h("meta", ["charset", "utf-8"], []) + h("title", [], [escapeHtml(title)]),
    h("main", [], [body]),
  );
}

function PostCard(post: Post): string {
  return h(
    "article",
    ["class", "post"],
    [h("h1", [], [escapeHtml(post.title)]), h("p", [], [escapeHtml(post.body)])],
  );
}

export function buildApp(revalidateSeconds: number) {
  const app = createRouter();

  // SSG: render once at startup; the route serves the baked string.
  const items: string[] = [];
  for (const p of POSTS) {
    items.push(h("li", [], [h("a", ["href", "/post/" + p.slug], [escapeHtml(p.title)])]));
  }
  const indexMarkup = Layout("posts", h("ul", [], items));
  app.get("/", (c) => c.html(indexMarkup));

  // ISR: one cached document per slug, re-rendered after revalidateSeconds.
  const postPages: { slug: string; view: IsrPage }[] = [];
  for (const post of POSTS) {
    let renders = 0;
    postPages.push({
      slug: post.slug,
      view: new IsrPage(() => {
        renders++;
        return Layout(post.title, PostCard(post) + h("p", [], [escapeHtml("render " + renders)]));
      }, revalidateSeconds),
    });
  }
  app.get("/post/:slug", (c) => {
    const slug = c.req.param("slug");
    for (const p of postPages) {
      if (p.slug === slug) {
        return c.html(p.view.html());
      }
    }
    return c.status(404).html(Layout("404", h("p", [], ["no such post"])));
  });

  return app;
}
