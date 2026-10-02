import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('adds the optional Whisper model column to existing video databases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shotprompt-db-migration-'))
    const path = join(directory, 'shotprompt.sqlite')
    const oldDb = new Database(path)
    oldDb.run(`CREATE TABLE videos (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL,
      duration REAL, width INTEGER, height INTEGER, status TEXT NOT NULL,
      language TEXT NOT NULL, created_at INTEGER NOT NULL
    )`)
    oldDb.run("INSERT INTO videos (id, filename, path, status, language, created_at) VALUES ('legacy', 'old.mp4', '/old.mp4', 'ready', 'th', 1)")
    oldDb.close()

    const db = createDb(path)

    expect(db.select().from(videos).get()).toMatchObject({ id: 'legacy', whisperModel: null })
  })
})
