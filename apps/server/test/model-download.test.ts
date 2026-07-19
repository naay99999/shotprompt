import { expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadModel } from '../src/routes/system'

it('downloads to .tmp.bin then renames; resumes with Range', async () => {
  const DATA = '0123456789'
  // Captured in an object (rather than a bare `let`) so TypeScript's control-flow
  // narrowing doesn't collapse the type to `null` at the read site below — reads of a
  // `let` reassigned only inside a nested closure aren't tracked across the function
  // boundary by tsc's CFA, which otherwise makes `expect(lastRange)` fail to typecheck.
  const state: { lastRange: string | null } = { lastRange: null }
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      state.lastRange = req.headers.get('range')
      const start = state.lastRange ? Number(state.lastRange.match(/bytes=(\d+)-/)![1]) : 0
      return new Response(DATA.slice(start), {
        status: state.lastRange ? 206 : 200,
        headers: { 'content-length': String(DATA.length - start) },
      })
    },
  })
  const url = `http://127.0.0.1:${server.port}/model.bin`
  const dest = join(mkdtempSync(join(tmpdir(), 'sp-')), 'ggml-tiny.bin')
  // simulate a previously interrupted download: 4 bytes already in the tmp file
  writeFileSync(dest + '.tmp.bin', DATA.slice(0, 4))
  await downloadModel(url, dest, () => {})
  expect(state.lastRange).toBe('bytes=4-')
  expect(existsSync(dest + '.tmp.bin')).toBe(false)
  expect(readFileSync(dest, 'utf8')).toBe(DATA)
  server.stop()
})
