import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { Ctx } from './context'
import { systemRoutes, type SystemRuntime } from './routes/system'
import { videoRoutes } from './routes/videos'
import { jobRoutes } from './routes/jobs'
import { clipRoutes } from './routes/clips'
import { analysisRoutes } from './routes/analysis'
import { analysisSettingsRoutes } from './routes/analysis-settings'
import { exportRoutes } from './routes/exports'

export function createApp(ctx: Ctx, systemRuntime?: SystemRuntime) {
  // standardHostname:false disables an Elysia/Bun router optimization that assumes
  // "real" (multi-char) hostnames when slicing the pathname out of request.url via
  // indexOf offsets. Without it, short hosts (e.g. the `http://x/...` used in tests)
  // resolve to the wrong path and 404. Safe to disable in all environments since it
  // only affects how the pathname is parsed, not routing correctness.
  return new Elysia({ handler: { standardHostname: false } })
    .use(cors({ origin: ['http://127.0.0.1:3000', 'http://localhost:3000'] }))
    .use(systemRoutes(ctx.db, systemRuntime))
    .use(videoRoutes(ctx))
    .use(jobRoutes(ctx))
    .use(analysisRoutes(ctx))
    .use(analysisSettingsRoutes(ctx))
    .use(clipRoutes(ctx))
    .use(exportRoutes(ctx))
}
export type App = ReturnType<typeof createApp>
