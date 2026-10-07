import { treaty } from '@elysiajs/eden'
import type { App } from '@shotprompt/server'

export const api = treaty<App>('http://127.0.0.1:3101')
export const API_BASE = 'http://127.0.0.1:3101'
