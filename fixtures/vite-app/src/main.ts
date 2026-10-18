// Compiled-path entry (contracts/route-contract.md): the generated dispatch is
// registered once via withDispatch — app.serve/app.handler try it FIRST on
// every request, and a `false` return declines to the internal dispatch,
// which covers bailed routes, notFound, and misses.
import { app } from './routes.chttp.ts'
import { CompiledRoutes } from './.chttp/routes.gen.ts'
import { CompiledFetchRoutes } from './.chttp/routes.gen.fetch.ts'

const port = process.argv.length > 2 ? Number(process.argv[2]) : 3100

app.withDispatch(new CompiledRoutes(app))
// Web Standards arm (contracts/route-contract-fetch.md): app.fetch tries
// this generated dispatch first and declines to the runtime path on false.
app.withFetchDispatch(new CompiledFetchRoutes(app))
app.serve({ port: port })

console.log('vite-app (compiled dispatch) listening on :' + port)
