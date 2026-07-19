import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { DB } from '@shotprompt/db'
import { systemRoutes } from './routes/system'

export function createApp(db: DB) {
  // standardHostname:false disables an Elysia/Bun router optimization that assumes
  // "real" (multi-char) hostnames when slicing the pathname out of request.url via
  // indexOf offsets. Without it, short hosts (e.g. the `http://x/...` used in tests)
  // resolve to the wrong path and 404. Safe to disable in all environments since it
  // only affects how the pathname is parsed, not routing correctness.
  return new Elysia({ handler: { standardHostname: false } })
    .use(cors({ origin: ['http://127.0.0.1:3000', 'http://localhost:3000'] }))
    .use(systemRoutes(db))
}
export type App = ReturnType<typeof createApp>
