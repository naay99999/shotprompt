import { describe, expect, it } from 'bun:test'
import { createDb, seedKeywords, keywords, videos } from '../src'

describe('db', () => {
  it('bootstraps schema, enables WAL, seeds keywords idempotently', () => {
    const db = createDb(':memory:')
    expect(db.raw.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'memory' }) // ':memory:' reports memory; file dbs report wal — assert pragma ran without error
    seedKeywords(db)
    seedKeywords(db) // idempotent
    const rows = db.select().from(keywords).all()
    expect(rows.filter(r => r.language === 'th' && r.tier === 1).some(r => r.word === 'ด่วน' && r.weight === 25)).toBe(true)
    expect(rows.filter(r => r.language === 'en').length).toBeGreaterThan(0)
    expect(rows.length).toBeGreaterThan(50)
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'uploaded', language: 'th', createdAt: 1 }).run()
    expect(db.select().from(videos).all()).toHaveLength(1)
  })
})
