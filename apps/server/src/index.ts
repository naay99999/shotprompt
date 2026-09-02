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
// Bun's default maxRequestBodySize (128 MiB) rejects multipart uploads of any real
// live-commerce recording (often several hundred MB to a few GB) with a 413 before the
// route handler ever runs — raise it well above what a single video upload needs.
createApp(ctx).listen({ hostname: '127.0.0.1', port: 3001, maxRequestBodySize: 20 * 1024 * 1024 * 1024 })
console.log('server on http://127.0.0.1:3001')
