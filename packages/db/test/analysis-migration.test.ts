import { expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, candidates } from '../src';
it('migrates legacy scores without normalization and supports null scores after reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-db-')); const path = join(dir, 'db.sqlite');
  try {
    const old = new Database(path);
    old.run('CREATE TABLE candidates (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, score REAL NOT NULL, thumbnail_path TEXT)');
    old.run("INSERT INTO candidates VALUES ('legacy', 'v1', 0, 10, 148, NULL)"); old.close();
    let db = createDb(path); db.raw.close(); db = createDb(path);
    expect(db.select().from(candidates).get()).toMatchObject({ id: 'legacy', score: 148, runId: null, assessmentJson: null });
    db.insert(candidates).values({ id: 'new', videoId: 'v1', start: 20, end: 30, score: null }).run();
    expect(db.select().from(candidates).all()).toHaveLength(2); db.raw.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rolls back candidate migration if a schema operation fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-rollback-')), path = join(dir, 'db.sqlite');
  try {
    const raw = new Database(path);
    raw.run('CREATE TABLE candidates (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, score REAL NOT NULL, thumbnail_path TEXT)');
    raw.run("INSERT INTO candidates VALUES ('old', 'v', 0, 5, 88, NULL)");
    raw.run('CREATE TABLE candidates_analysis_migration (id TEXT)'); raw.close();
    expect(() => createDb(path)).toThrow();
    const check = new Database(path);
    expect(check.query('SELECT id, score FROM candidates').get()).toEqual({ id: 'old', score: 88 });
    expect((check.query('PRAGMA table_info(videos)').all() as { name: string }[]).some(c => c.name === 'active_analysis_run_id')).toBe(false); check.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
