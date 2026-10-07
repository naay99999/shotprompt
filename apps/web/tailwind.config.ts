import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#151513',
        surface: '#1d1d1a',
        surface2: '#191916',
        header: '#191916',
        line: '#2b2b26',
        line2: '#32322b',
        line3: '#414138',
        ink: '#f1eee7',
        muted: '#bdbbb0',
        dim: '#b0aea2',
        faint: '#a7a597',
        accent: '#e59860',
        ok: '#62b97c',
        err: '#e06a5e',
        warn: '#d9a13f',
      },
    },
  },
} satisfies Config
