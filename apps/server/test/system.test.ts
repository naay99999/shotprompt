import { describe, expect, it } from 'bun:test'
import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from '../src/app'
import { createCtx } from '../src/context'

const app = () => { const db = createDb(':memory:'); seedKeywords(db); return createApp(createCtx(db, { autoRun: false })) }

describe('system routes', () => {
  it('doctor reports binary and model status', async () => {
    const res = await app().handle(new Request('http://x/system/doctor'))
    const body = await res.json()
    expect(typeof body.ffmpeg).toBe('boolean')
    expect(body.model.name).toBe('large-v3')
  })
  it('settings roundtrip', async () => {
    const a = app()
    await a.handle(new Request('http://x/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whisperModel: 'medium' }) }))
    const res = await a.handle(new Request('http://x/settings'))
    expect((await res.json()).whisperModel).toBe('medium')
  })
  it('SSE responds with event-stream and heartbeat header', async () => {
    const res = await app().handle(new Request('http://x/events'))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})
