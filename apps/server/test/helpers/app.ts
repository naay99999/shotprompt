import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from '../../src/app'
import { createCtx } from '../../src/context'
import type { SystemRuntime } from '../../src/routes/system'

export function createTestApp(systemRuntime?: SystemRuntime) {
  const db = createDb(':memory:')
  seedKeywords(db)
  const runtime = systemRuntime ?? {
    platform: 'darwin', architecture: 'arm64', hasCommand: () => false,
    run: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: false }),
  }
  return { app: createApp(createCtx(db, { autoRun: false }), runtime), db }
}
