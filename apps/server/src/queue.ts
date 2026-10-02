import type { Subprocess } from 'bun'
import { eq } from 'drizzle-orm'
import { analysisRuns, jobs, type DB } from '@shotprompt/db'
import { emitEvent } from './events'

export interface JobCtx { signal: AbortSignal; setChild(p: Subprocess | null): void }
export type JobRunner = (jobId: string, ctx: JobCtx) => Promise<void>

export class JobQueue {
  private pending: string[] = []
  private running: { jobId: string; controller: AbortController; child: Subprocess | null } | null = null
  private waiters: (() => void)[] = []

  constructor(private db: DB, private type: 'pipeline' | 'export' | 'analysis', private runner: JobRunner, private hooks: { onDone?: (jobId: string) => void } = {}) {}

  enqueue(jobId: string) { this.pending.push(jobId); this.pump() }

  cancel(jobId: string): boolean {
    if (this.type === 'analysis' && this.db.select().from(analysisRuns).where(eq(analysisRuns.jobId, jobId)).get()?.status === 'done') return false;
    const qi = this.pending.indexOf(jobId)
    if (qi >= 0) { this.pending.splice(qi, 1); this.mark(jobId, 'canceled'); return true }
    if (this.running?.jobId === jobId) {
      this.running.controller.abort()
      this.running.child?.kill()
      return true
    }
    return false
  }

  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    return new Promise(res => this.waiters.push(res))
  }

  private mark(jobId: string, status: string, error?: string) {
    const now = Date.now()
    if (this.type === 'analysis' && status === 'canceled') {
      this.db.update(analysisRuns).set({ status: 'canceled', completedAt: now }).where(eq(analysisRuns.jobId, jobId)).run()
    }
    this.db.update(jobs).set({ status, error: error ?? null, ...(status === 'running' ? { startedAt: now } : { completedAt: now }) })
      .where(eq(jobs.id, jobId)).run()
    const row = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    emitEvent('job:update', { jobId, videoId: row?.videoId, jobType: this.type, status })
  }

  private async pump() {
    if (this.running || this.pending.length === 0) {
      if (!this.running && this.pending.length === 0) { this.waiters.forEach(w => w()); this.waiters = [] }
      return
    }
    const jobId = this.pending.shift()!
    const controller = new AbortController()
    this.running = { jobId, controller, child: null }
    this.mark(jobId, 'running')
    try {
      await this.runner(jobId, { signal: controller.signal, setChild: p => { if (this.running) this.running.child = p } })
      this.mark(jobId, controller.signal.aborted ? 'canceled' : 'done')
      if (!controller.signal.aborted) {
        try { this.hooks.onDone?.(jobId) }
        catch { emitEvent('analysis:schedule-error', { jobId, message: 'automatic-analysis-not-started' }) }
      }
    } catch (e) {
      this.mark(jobId, controller.signal.aborted ? 'canceled' : 'failed', e instanceof Error ? e.message : String(e))
    } finally {
      this.running = null
      this.pump()
    }
  }
}
