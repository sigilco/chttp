# @chttp/html

## 0.4.0

### Minor Changes

- Add `page(head, body)` full-document shell and `IsrPage` revalidate cache: the pages/SSG/ISR slice of issue #14. SSG is render-once-at-startup; ISR re-renders lazily after the TTL (blocking semantics, no background refresh). See `examples/pages`.

## 0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- Add @chttp/html: subset-native HTML rendering (escapeHtml, h, html tag) and a node-only jsx-runtime
