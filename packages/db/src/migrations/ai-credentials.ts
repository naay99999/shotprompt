import type { Database } from 'bun:sqlite';
export function migrateAiCredentials(raw: Database): void {
  raw.run(`CREATE TABLE IF NOT EXISTS ai_credentials (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  raw.run('CREATE INDEX IF NOT EXISTS ai_credentials_profile_id_idx ON ai_credentials(profile_id)');
}
