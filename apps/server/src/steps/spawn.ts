import type { JobCtx } from '../queue'
import { LineDecoder } from './line-decoder'

export async function runCmd(
  cmd: string, args: string[], ctx: JobCtx,
  opts: { onStdoutLine?: (line: string) => void; onStderrLine?: (line: string) => void; ignoreExitCode?: boolean } = {},
): Promise<{ stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  ctx.setChild(proc)
  const onAbort = () => proc.kill()
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  const consumeLines = async (stream: ReadableStream<Uint8Array>, onLine?: (line: string) => void) => {
    const decoder = new LineDecoder()
    const textDecoder = new TextDecoder()
    let text = ''
    for await (const chunk of stream) {
      text += textDecoder.decode(chunk, { stream: true })
      if (onLine) for (const line of decoder.push(chunk)) onLine(line)
    }
    text += textDecoder.decode()
    if (onLine) for (const line of decoder.finish()) onLine(line)
    return text
  }
  const stdoutDone = opts.onStdoutLine ? consumeLines(proc.stdout, opts.onStdoutLine) : new Response(proc.stdout).text()
  const stderrDone = opts.onStderrLine ? consumeLines(proc.stderr, opts.onStderrLine) : new Response(proc.stderr).text()
  const stderr = await stderrDone
  const code = await proc.exited
  await stdoutDone
  ctx.setChild(null)
  ctx.signal.removeEventListener('abort', onAbort)
  if (ctx.signal.aborted) throw new Error('canceled')
  if (code !== 0 && !opts.ignoreExitCode) throw new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`)
  return { stderr }
}

export async function renameTmp(tmp: string, final: string) {
  const { renameSync } = await import('node:fs')
  renameSync(tmp, final)
}
