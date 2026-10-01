import { describe, expect, it } from 'bun:test'
import { getInstallGuide, parseLibassSupport } from '../src/routes/system'
import { createTestApp } from './helpers/app'

const app = () => createTestApp().app

// Real `ffmpeg -filters` output, trimmed, as captured on a Homebrew build that lacks
// libass (`brew install ffmpeg` without a libass-enabling formula/tap): no `ass` or
// `subtitles` line, but plenty of filter names/descriptions containing "ass" as a
// plain substring (asplit, aselect, bandpass, "to pass in output") that a naive
// substring search would false-positive on.
const FILTERS_WITHOUT_LIBASS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  ..C = Command support
  A = Audio input/output
  V = Video input/output
  N = Dynamic number and/or type of input/output
  | = Source or sink filter
 ... aselect           A->N       Select audio frames to pass in output.
 ... asplit            A->N       Pass on the audio input to N audio outputs.
 TS. bandpass          A->A       Apply a two-pole Butterworth band-pass filter.
 TS. highpass          A->A       Apply a high-pass filter with 3dB point frequency.
 T.. allpass           A->A       Apply a two-pole all-pass filter.`

// Same shape, but from a build configured `--enable-libass`: adds the `ass` and
// `subtitles` filters (the ones the export pipeline's burn-subtitles path needs).
const FILTERS_WITH_LIBASS = `${FILTERS_WITHOUT_LIBASS}
 T.C ass               V->V       Render subtitles onto input video using the libass library.
 T.C subtitles         V->V       Render text subtitles onto input video using the libavcodec subtitle rendering and libass.`

describe('parseLibassSupport', () => {
  it('returns false when ffmpeg -filters has no ass/subtitles filter (Homebrew default build)', () => {
    expect(parseLibassSupport(FILTERS_WITHOUT_LIBASS)).toBe(false)
  })
  it('does not false-positive on names/descriptions merely containing "ass" as a substring', () => {
    // Sanity check that the fixture itself would trip a naive `includes('ass')` check,
    // proving the precise parser is doing real work rather than the fixture being weak.
    expect(FILTERS_WITHOUT_LIBASS.includes('ass')).toBe(true)
    expect(parseLibassSupport(FILTERS_WITHOUT_LIBASS)).toBe(false)
  })
  it('returns true when the ass/subtitles filters are present (libass-enabled build)', () => {
    expect(parseLibassSupport(FILTERS_WITH_LIBASS)).toBe(true)
  })
  it('returns true given only the subtitles filter (ass filter name alone can vary by build)', () => {
    const onlySubtitles = `${FILTERS_WITHOUT_LIBASS}\n T.C subtitles         V->V       Render text subtitles.`
    expect(parseLibassSupport(onlySubtitles)).toBe(true)
  })
})

describe('getInstallGuide', () => {
  it('provides the Homebrew command for macOS', () => {
    expect(getInstallGuide('darwin', 'arm64', () => false)).toEqual({
      platform: 'macos', architecture: 'arm64', manager: 'homebrew',
      commands: ['brew install ffmpeg-full whisper-cpp && brew link --overwrite ffmpeg-full'],
      note: 'ต้องติดตั้ง Homebrew ก่อน หากคำสั่ง brew ยังไม่พร้อมใช้งาน',
      manualUrl: 'https://brew.sh/',
    })
  })

  it('uses Winget for FFmpeg and documents Whisper.cpp’s manual Windows fallback', () => {
    const guide = getInstallGuide('win32', 'x64', command => command === 'winget')

    expect(guide.platform).toBe('windows')
    expect(guide.manager).toBe('winget')
    expect(guide.commands).toEqual(['winget install --id Gyan.FFmpeg --exact'])
    expect(guide.note).toContain('whisper-cli')
    expect(guide.manualUrl).toBe('https://github.com/ggml-org/whisper.cpp/releases')
  })

  it('does not invent a distro package command when Linux has no supported package manager', () => {
    const guide = getInstallGuide('linux', 'x64', () => false)

    expect(guide.platform).toBe('linux')
    expect(guide.manager).toBe('manual')
    expect(guide.commands).toEqual([])
    expect(guide.manualUrl).toBe('https://github.com/ggml-org/whisper.cpp/releases')
  })

  it('uses Linux Homebrew before distro package managers', () => {
    const guide = getInstallGuide('linux', 'x64', command => ['brew', 'apt-get', 'pacman'].includes(command))

    expect(guide.manager).toBe('homebrew')
    expect(guide.commands).toEqual(['brew install ffmpeg-full whisper-cpp && brew link --overwrite ffmpeg-full'])
  })

  it('uses apt-get for FFmpeg and explains Whisper needs a separate install', () => {
    const guide = getInstallGuide('linux', 'x64', command => command === 'apt-get')

    expect(guide.manager).toBe('apt-get')
    expect(guide.commands).toEqual(['sudo apt-get update && sudo apt-get install -y ffmpeg'])
    expect(guide.note).toContain('whisper-cli')
    expect(guide.manualUrl).toBe('https://github.com/ggml-org/whisper.cpp/releases')
  })

  it('uses pacman for supported x64 Linux hosts', () => {
    const guide = getInstallGuide('linux', 'x64', command => command === 'pacman')

    expect(guide.manager).toBe('pacman')
    expect(guide.commands).toEqual(['sudo pacman -S --needed ffmpeg whisper-cpp'])
  })

  it('prioritizes Scoop over WinGet on Windows', () => {
    const guide = getInstallGuide('win32', 'x64', command => ['scoop', 'winget'].includes(command))

    expect(guide.manager).toBe('scoop')
    expect(guide.commands).toEqual(['scoop install ffmpeg whisper-cpp'])
  })

  it('uses manual guidance when WinGet is the only manager on Windows ARM64', () => {
    const guide = getInstallGuide('win32', 'arm64', command => command === 'winget')

    expect(guide.manager).toBe('manual')
    expect(guide.commands).toEqual([])
    expect(guide.note).toContain('whisper-cli.exe')
    expect(guide.manualUrl).toBe('https://github.com/ggml-org/whisper.cpp/releases')
  })

  it('uses manual guidance for pacman on unsupported Linux architectures', () => {
    const guide = getInstallGuide('linux', 'arm64', command => command === 'pacman')

    expect(guide.manager).toBe('manual')
    expect(guide.commands).toEqual([])
  })
})

describe('system routes', () => {
  it('doctor reports binary, libass, and model status', async () => {
    const res = await app().handle(new Request('http://x/system/doctor'))
    const body = await res.json()
    expect(typeof body.ffmpeg).toBe('boolean')
    expect(typeof body.libass).toBe('boolean')
    expect(body.model.name).toBe('large-v3')
    expect(body.installGuide.platform).toBe('macos')
    expect(body.installGuide.commands).toHaveLength(1)
    expect(Array.isArray(body.models)).toBe(true)
    const names = body.models.map((m: { name: string }) => m.name)
    expect(names).toContain('large-v3')
    expect(names).toContain('medium')
  })
  it('doctor.models includes the configured model even if it is not one of the two known picks', async () => {
    const a = app()
    await a.handle(new Request('http://x/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whisperModel: 'tiny' }) }))
    const res = await a.handle(new Request('http://x/system/doctor'))
    const body = await res.json()
    const names = body.models.map((m: { name: string }) => m.name)
    expect(names).toContain('tiny')
    expect(names).toContain('large-v3')
    expect(names).toContain('medium')
  })
  it('settings roundtrip', async () => {
    const a = app()
    await a.handle(new Request('http://x/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whisperModel: 'medium' }) }))
    const res = await a.handle(new Request('http://x/settings'))
    expect((await res.json()).whisperModel).toBe('medium')
  })
  it('SSE responds with event-stream and heartbeat header', async () => {
    const res = await app().handle(new Request('http://x/events'))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
  it('rejects a model/download request whose model name looks like a path traversal attempt', async () => {
    const res = await app().handle(new Request('http://x/system/model/download', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: '../../etc/passwd' }),
    }))
    expect(res.status).toBe(400)
  })
})
