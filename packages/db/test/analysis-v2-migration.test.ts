import { expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrateAnalysisV2 } from '../src/migrations/analysis-v2';
it('adds nullable AI metadata idempotently while preserving legacy data', () => {
  const raw = new Database(':memory:');
  raw.run('CREATE TABLE analysis_runs(id TEXT PRIMARY KEY, engine_version TEXT);');
  raw.run("INSERT INTO analysis_runs VALUES ('old', 'rules-v1')");
  raw.run('CREATE TABLE candidates(id TEXT PRIMARY KEY, score REAL)'); raw.run("INSERT INTO candidates VALUES ('c', 148)");
  migrateAnalysisV2(raw); migrateAnalysisV2(raw);
  expect(raw.query('SELECT * FROM analysis_runs').get()).toEqual({ id: 'old', engine_version: 'rules-v1', evaluator_metadata_json: null, progress_json: null });
  expect(raw.query('SELECT * FROM candidates').get()).toEqual({ id: 'c', score: 148 }); raw.close();
});
