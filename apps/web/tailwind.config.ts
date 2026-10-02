import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#161513',
        surface: '#1d1b19',
        surface2: '#161513',
        header: '#191816',
        line: '#26241f',
        line2: '#2b2925',
        line3: '#34312b',
        ink: '#edeae5',
        muted: '#b9b2a7',
        dim: '#aaa397',
        faint: '#a29c92',
        accent: '#e8823f',
        ok: '#62b97c',
        err: '#e06a5e',
        warn: '#d9a13f',
      },
    },
  },
} satisfies Config
