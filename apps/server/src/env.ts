import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { settings, type DB } from '@shotprompt/db'

export const ROOT = join(import.meta.dir, '..', '..', '..')
export const DATA_DIR = process.env.SHOTPROMPT_DATA ?? join(ROOT, 'data')
export const MODELS_DIR = join(DATA_DIR, 'models')
export const FONTS_DIR = join(ROOT, 'assets', 'fonts')
export const videoDir = (id: string) => join(DATA_DIR, 'videos', id)
export const modelPath = (name: string) => join(MODELS_DIR, `ggml-${name}.bin`)

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? fallback
}
export function setSetting(db: DB, key: string, value: string) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
}
