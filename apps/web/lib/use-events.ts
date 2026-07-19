'use client'
import { useEffect, useRef } from 'react'
import { API_BASE } from './api'

export function useEvents(handler: (e: { type: string; [k: string]: unknown }) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    let first = true
    const es = new EventSource(`${API_BASE}/events`)
    es.onopen = () => {
      if (!first) ref.current({ type: '$reconnect' })
      first = false
    }
    es.onmessage = ev => ref.current(JSON.parse(ev.data))
    return () => es.close()
  }, [])
}
