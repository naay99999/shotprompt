import { DEFAULT_HOOK_TIERS_TH, DEFAULT_HOOK_TIERS_EN } from '@shotprompt/core'
import { keywords } from './schema'
import type { DB } from './client'

export function seedKeywords(db: DB) {
  const existing = db.select().from(keywords).all()
  if (existing.length > 0) return
  const rows: { language: string; tier: number; word: string; weight: number }[] = []
  for (const [language, tiers] of [['th', DEFAULT_HOOK_TIERS_TH], ['en', DEFAULT_HOOK_TIERS_EN]] as const) {
    for (const t of tiers) for (const word of t.keywords) rows.push({ language, tier: t.tier, word, weight: t.weight })
  }
  db.insert(keywords).values(rows).run()
}
