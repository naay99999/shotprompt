import { createDb, seedKeywords, type DB } from '@shotprompt/db'
import { createApp } from '../../src/app'
import { createCtx } from '../../src/context'
import type { SystemRuntime } from '../../src/routes/system'
import type { CredentialVault } from '../../src/ai/credential-vault'

type TestAppOptions = { modelAvailable?: (name: string) => boolean; credentialVault?: CredentialVault; db?: DB }

export function createTestApp(optionsOrRuntime: TestAppOptions | SystemRuntime = {}, injectedRuntime?: SystemRuntime) {
  const options = 'run' in optionsOrRuntime ? {} : optionsOrRuntime
  const systemRuntime = ('run' in optionsOrRuntime ? optionsOrRuntime : injectedRuntime) ?? {
    platform: 'darwin', architecture: 'arm64', hasCommand: () => false,
    run: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: false }),
  }
  const db = options.db ?? createDb(':memory:')
  seedKeywords(db)
  const ctx = createCtx(db, { autoRun: false, ...options })
  return { app: createApp(ctx, systemRuntime), db, ctx }
}
