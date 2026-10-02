import { expect, it } from 'bun:test';
import { createDb } from '../src/client';
const migration: any = await import('../src/migrations/ai-credentials').catch(() => ({}));

it('adds an isolated encrypted credential table idempotently without changing legacy analysis data', () => {
  const db = createDb(':memory:');
  db.raw.run("INSERT INTO videos (id,filename,path,status,language,created_at) VALUES ('v','old.mp4','/old.mp4','ready','th',1)");
  db.raw.run("INSERT INTO candidates (id,video_id,start,end,score) VALUES ('old','v',0,20,148)");
  expect(() => migration.migrateAiCredentials(db.raw)).not.toThrow();
  expect(() => migration.migrateAiCredentials(db.raw)).not.toThrow();
  const tables = db.raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_credentials'").all();
  expect(tables).toHaveLength(1);
  expect(db.raw.query("SELECT score FROM candidates WHERE id='old'").get()).toEqual({ score: 148 });
  db.raw.close();
});
