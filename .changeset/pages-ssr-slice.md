---
"@chttp/html": minor
---

Add `page(head, body)` full-document shell and `IsrPage` revalidate cache: the pages/SSG/ISR slice of issue #14. SSG is render-once-at-startup; ISR re-renders lazily after the TTL (blocking semantics, no background refresh). See `examples/pages`.
