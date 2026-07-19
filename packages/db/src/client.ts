import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

const DDL = `
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL, duration REAL, width INTEGER, height INTEGER, status TEXT NOT NULL, language TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, error TEXT, started_at INTEGER, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS segments (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenes (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, time REAL NOT NULL);
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, score REAL NOT NULL, thumbnail_path TEXT);
CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, candidate_id TEXT, start REAL NOT NULL, end REAL NOT NULL, score REAL, crop_offset REAL NOT NULL DEFAULT 0, thumbnail_path TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clip_subtitles (id INTEGER PRIMARY KEY AUTOINCREMENT, clip_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, clip_id TEXT NOT NULL, aspect TEXT NOT NULL, burn_subtitles INTEGER NOT NULL, status TEXT NOT NULL, path TEXT, error TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT NOT NULL, tier INTEGER NOT NULL, word TEXT NOT NULL, weight INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export type DB = BunSQLiteDatabase<typeof schema> & { raw: Database }

export function createDb(path: string): DB {
  const raw = new Database(path, { create: true })
  raw.run('PRAGMA journal_mode=WAL')
  raw.run('PRAGMA busy_timeout=5000')
  for (const stmt of DDL.split(';').map(s => s.trim()).filter(Boolean)) raw.run(stmt)
  const db = drizzle(raw, { schema })
  return Object.assign(db, { raw }) as DB
}
