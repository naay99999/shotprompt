import type { Metadata } from 'next'
import '@vidstack/react/player/styles/base.css'
import './globals.css'
import { NavigationGuard } from '@/components/navigation-guard'

export const metadata: Metadata = {
  title: 'ShotPrompt',
  description: 'Local-first live-commerce video transcription and clipping tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-bg text-ink min-h-screen"><NavigationGuard>{children}</NavigationGuard></body>
    </html>
  )
}
