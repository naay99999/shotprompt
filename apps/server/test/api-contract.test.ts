import { expect, test } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { createTestApp } from './helpers/app'
import { createReadyVideo } from './helpers/fixtures'

test('Eden client preserves video-list and settings response contracts', async () => {
  const { app, db } = createTestApp()
  createReadyVideo(db, { id: 'v-contract', filename: 'contract.mp4', path: '/tmp/contract.mp4' })

  const api = treaty(app)
  const videoResponse = await api.videos.get()
  const settingsResponse = await api.settings.get()

  expect(videoResponse.error).toBeNull()
  expect(videoResponse.data).toEqual([{
    id: 'v-contract', filename: 'contract.mp4', path: '/tmp/contract.mp4',
    duration: null, width: null, height: null, status: 'ready', language: 'th',
    createdAt: 1, clipCount: 0,
  }])
  expect(settingsResponse.error).toBeNull()
  expect(settingsResponse.data).toEqual({ whisperModel: 'large-v3' })
})

test('Eden client preserves a missing-video error response', async () => {
  const { app } = createTestApp()
  const response = await treaty(app).videos({ id: 'missing' }).get()

  expect(response.data).toBeNull()
  expect(response.error?.status).toBe(404)
  expect(response.error?.value).toEqual({ message: 'not found' })
})
