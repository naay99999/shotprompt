import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ShotPrompt',
  description: 'Local-first live-commerce video transcription and clipping tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-bg text-ink min-h-screen">{children}</body>
    </html>
  )
}
