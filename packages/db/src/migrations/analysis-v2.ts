import type { Database } from 'bun:sqlite';
export function migrateAnalysisV2(raw: Database): void {
  raw.transaction(() => {
    const columns = raw.query('PRAGMA table_info(analysis_runs)').all() as { name: string }[];
    for (const name of ['evaluator_metadata_json', 'progress_json']) if (!columns.some(c => c.name === name)) raw.run(`ALTER TABLE analysis_runs ADD COLUMN ${name} TEXT`);
  })();
}
