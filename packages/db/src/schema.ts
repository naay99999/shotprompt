import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  duration: real('duration'),
  width: integer('width'),
  height: integer('height'),
  status: text('status').notNull(), // uploaded|processing|ready|failed
  language: text('language').notNull(), // th|en
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
  score: real('score').notNull(),
  thumbnailPath: text('thumbnail_path'),
})
export const clips = sqliteTable('clips', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
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
