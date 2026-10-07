import type { Metadata } from 'next'
import { Geist, Noto_Sans_Thai } from 'next/font/google'
import '@vidstack/react/player/styles/base.css'
import './globals.css'
import { NavigationGuard } from '@/components/navigation-guard'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const thai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-thai', display: 'swap' });

export const metadata: Metadata = {
  title: 'ShotPrompt',
  description: 'Local-first live-commerce video transcription and clipping tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${geist.variable} ${thai.variable}`}>
      <body className="bg-bg text-ink min-h-screen"><NavigationGuard>{children}</NavigationGuard></body>
    </html>
  )
}
