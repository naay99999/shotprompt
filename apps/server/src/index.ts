import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from './app'
import { createCtx } from './context'
import { DATA_DIR, MODELS_DIR } from './env'
import { recover } from './recovery'

mkdirSync(MODELS_DIR, { recursive: true })
mkdirSync(join(DATA_DIR, 'videos'), { recursive: true })
const db = createDb(join(DATA_DIR, 'shotprompt.db'))
seedKeywords(db)
recover(db)
const ctx = createCtx(db)
createApp(ctx).listen({ hostname: '127.0.0.1', port: 3001 })
console.log('server on http://127.0.0.1:3001')
