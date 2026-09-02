import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from '../../src/app'
import { createCtx } from '../../src/context'

export function createTestApp() {
  const db = createDb(':memory:')
  seedKeywords(db)
  return { app: createApp(createCtx(db, { autoRun: false })), db }
}
