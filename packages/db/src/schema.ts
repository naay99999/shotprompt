import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  duration: real('duration'),
  width: integer('width'),
  height: integer('height'),
  status: text('status').notNull(), // uploaded|processing|ready|failed
  language: text('language').notNull(), // Whisper.cpp language code
  whisperModel: text('whisper_model'),
  activeAnalysisRunId: text('active_analysis_run_id'),
  analysisOptionsJson: text('analysis_options_json'),
  createdAt: integer('created_at').notNull(),
})
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  type: text('type').notNull(), // pipeline|export
  status: text('status').notNull(), // queued|running|done|failed|canceled
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})
export const jobSteps = sqliteTable('job_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})
export const segments = sqliteTable('segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  text: text('text').notNull(),
})
export const scenes = sqliteTable('scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull(),
  time: real('time').notNull(),
})
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  score: real('score'),
  runId: text('run_id'),
  assessmentJson: text('assessment_json'),
  rank: integer('rank'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(true),
  thumbnailPath: text('thumbnail_path'),
})
export const clips = sqliteTable('clips', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  assessmentJson: text('assessment_json'),
  candidateId: text('candidate_id'), // soft reference, no FK
  start: real('start').notNull(),
  end: real('end').notNull(),
  score: real('score'),
  cropOffset: real('crop_offset').notNull().default(0),
  thumbnailPath: text('thumbnail_path'),
  createdAt: integer('created_at').notNull(),
})
export const clipSubtitles = sqliteTable('clip_subtitles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clipId: text('clip_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  text: text('text').notNull(),
})
export const exportsTable = sqliteTable('exports', {
  id: text('id').primaryKey(),
  clipId: text('clip_id').notNull(),
  aspect: text('aspect').notNull(), // 9:16|16:9|original
  burnSubtitles: integer('burn_subtitles', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  path: text('path'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
})
export const keywords = sqliteTable('keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  language: text('language').notNull(),
  tier: integer('tier').notNull(),
  word: text('word').notNull(),
  weight: integer('weight').notNull(),
})
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const analysisRuns = sqliteTable('analysis_runs', {
  id: text('id').primaryKey(), videoId: text('video_id').notNull(), jobId: text('job_id').notNull(), status: text('status').notNull(),
  optionsJson: text('options_json').notNull(), engineVersion: text('engine_version').notNull(), sourceRevision: text('source_revision').notNull(),
  createdAt: integer('created_at').notNull(), completedAt: integer('completed_at'), error: text('error'),
  evaluatorMetadataJson: text('evaluator_metadata_json'), progressJson: text('progress_json'),
});
export const candidateFeedback = sqliteTable('candidate_feedback', {
  candidateId: text('candidate_id').primaryKey(), videoId: text('video_id').notNull(), runId: text('run_id'),
  verdict: text('verdict').notNull(), updatedAt: integer('updated_at').notNull(),
});

export const aiCredentials = sqliteTable('ai_credentials', {
  id: text('id').primaryKey(), profileId: text('profile_id').notNull(), version: integer('version').notNull(),
  ciphertext: text('ciphertext').notNull(), nonce: text('nonce').notNull(), authTag: text('auth_tag').notNull(), createdAt: integer('created_at').notNull(),
});
