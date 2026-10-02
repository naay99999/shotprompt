import { describe, expect, it } from 'bun:test'
import { isLanguage, WHISPER_LANGUAGES } from '../src'

describe('Whisper language registry', () => {
  it('contains every supported language code once', () => {
    const codes = WHISPER_LANGUAGES.map(language => language.code)

    expect(codes).toHaveLength(100)
    expect(new Set(codes).size).toBe(100)
    expect(codes).toContain('th')
    expect(codes).toContain('yue')
  })

  it('validates supported language codes', () => {
    expect(isLanguage('th')).toBe(true)
    expect(isLanguage('yue')).toBe(true)
    expect(isLanguage('xx')).toBe(false)
    expect(isLanguage('')).toBe(false)
  })
})
