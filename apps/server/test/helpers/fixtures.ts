import { clips, exportsTable, jobs, type DB, videos } from '@shotprompt/db'

type VideoValues = Partial<typeof videos.$inferInsert>
type JobValues = Partial<typeof jobs.$inferInsert>
type ClipValues = Partial<typeof clips.$inferInsert>
type ExportValues = Partial<typeof exportsTable.$inferInsert>

export function createReadyVideo(db: DB, values: VideoValues = {}) {
  db.insert(videos).values({
    id: 'v1', filename: 'a.mp4', path: '/x', status: 'ready', language: 'th', createdAt: 1,
    ...values,
  }).run()
}

export function createJob(db: DB, values: JobValues = {}) {
  db.insert(jobs).values({
    id: 'j1', videoId: 'v1', type: 'pipeline', status: 'queued', createdAt: 1,
    ...values,
  }).run()
}

export function createClip(db: DB, values: ClipValues = {}) {
  db.insert(clips).values({
    id: 'cl1', videoId: 'v1', start: 5, end: 20, cropOffset: 0, createdAt: 1,
    ...values,
  }).run()
}

export function createExport(db: DB, values: ExportValues = {}) {
  db.insert(exportsTable).values({
    id: 'e1', clipId: 'cl1', aspect: '9:16', burnSubtitles: false, status: 'queued', createdAt: 1,
    ...values,
  }).run()
}
