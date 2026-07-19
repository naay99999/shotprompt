import type { Metadata } from 'next'
import { Anuphan } from 'next/font/google'
import './globals.css'

const anuphan = Anuphan({ subsets: ['thai', 'latin'], weight: ['400', '500', '600', '700'] })

export const metadata: Metadata = {
  title: 'ShotPrompt',
  description: 'Local-first live-commerce video transcription and clipping tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={`${anuphan.className} bg-bg text-ink min-h-screen`}>{children}</body>
    </html>
  )
}
