import { EventEmitter } from 'node:events'

export const bus = new EventEmitter()
bus.setMaxListeners(50)
export const emitEvent = (type: string, payload: Record<string, unknown> = {}) =>
  bus.emit('event', { type, ...payload })

export function sseResponse(): Response {
  let listener: (e: unknown) => void
  let timer: ReturnType<typeof setInterval>
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      listener = e => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      bus.on('event', listener)
      timer = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 15_000)
    },
    cancel() { bus.off('event', listener); clearInterval(timer) },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}
