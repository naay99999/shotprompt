import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { Ctx } from './context'
import { systemRoutes } from './routes/system'
import { videoRoutes } from './routes/videos'
import { jobRoutes } from './routes/jobs'
import { clipRoutes } from './routes/clips'

export function createApp(ctx: Ctx) {
  // standardHostname:false disables an Elysia/Bun router optimization that assumes
  // "real" (multi-char) hostnames when slicing the pathname out of request.url via
  // indexOf offsets. Without it, short hosts (e.g. the `http://x/...` used in tests)
  // resolve to the wrong path and 404. Safe to disable in all environments since it
  // only affects how the pathname is parsed, not routing correctness.
  return new Elysia({ handler: { standardHostname: false } })
    .use(cors({ origin: ['http://127.0.0.1:3000', 'http://localhost:3000'] }))
    .use(systemRoutes(ctx.db))
    .use(videoRoutes(ctx))
    .use(jobRoutes(ctx))
    .use(clipRoutes(ctx))
}
export type App = ReturnType<typeof createApp>
