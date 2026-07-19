import { Elysia, status } from 'elysia'
import { eq } from 'drizzle-orm'
import { jobs } from '@shotprompt/db'
import type { Ctx } from '../context'

export const jobRoutes = (ctx: Ctx) => new Elysia()
  .post('/jobs/:id/cancel', ({ params }) => {
    const job = ctx.db.select().from(jobs).where(eq(jobs.id, params.id)).get()
    if (!job) return status(404, { message: 'not found' })

    const canceled = ctx.pipelineQueue.cancel(params.id) || ctx.exportQueue.cancel(params.id)
    if (!canceled) return status(409, { message: 'not cancelable' })
    return { ok: true }
  })
