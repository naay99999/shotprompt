import type { Database } from 'bun:sqlite';
export function migrateAnalysis(raw: Database): void {
  raw.transaction(() => {
    const add = (table: string, name: string, sql: string) => {
      const columns = raw.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(c => c.name === name)) raw.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
    };
    add('videos', 'active_analysis_run_id', 'TEXT'); add('videos', 'analysis_options_json', 'TEXT');
    add('clips', 'assessment_json', 'TEXT');
    const columns = raw.query('PRAGMA table_info(candidates)').all() as { name: string; notnull: number }[];
    if (columns.find(c => c.name === 'score')?.notnull) {
      raw.run('CREATE TABLE candidates_analysis_migration (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, score REAL, thumbnail_path TEXT)');
      raw.run('INSERT INTO candidates_analysis_migration SELECT id, video_id, start, end, score, thumbnail_path FROM candidates');
      raw.run('DROP TABLE candidates'); raw.run('ALTER TABLE candidates_analysis_migration RENAME TO candidates');
    }
    add('candidates', 'run_id', 'TEXT'); add('candidates', 'assessment_json', 'TEXT'); add('candidates', 'rank', 'INTEGER'); add('candidates', 'is_primary', 'INTEGER NOT NULL DEFAULT 1');
    raw.run(`CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY, video_id TEXT NOT NULL, job_id TEXT NOT NULL, status TEXT NOT NULL,
      options_json TEXT NOT NULL, engine_version TEXT NOT NULL, source_revision TEXT NOT NULL,
      created_at INTEGER NOT NULL, completed_at INTEGER, error TEXT)`);
    raw.run(`CREATE TABLE IF NOT EXISTS candidate_feedback (
      candidate_id TEXT PRIMARY KEY, video_id TEXT NOT NULL, run_id TEXT, verdict TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
    raw.run('CREATE INDEX IF NOT EXISTS candidates_run_idx ON candidates(video_id, run_id)');
    raw.run('CREATE INDEX IF NOT EXISTS analysis_runs_video_idx ON analysis_runs(video_id, created_at)');
    raw.run('CREATE INDEX IF NOT EXISTS analysis_runs_status_idx ON analysis_runs(status)');
    raw.run('CREATE INDEX IF NOT EXISTS candidate_feedback_video_idx ON candidate_feedback(video_id)');
  })();
}
