import type { JobCtx } from '../queue'

export async function runCmd(
  cmd: string, args: string[], ctx: JobCtx,
  opts: { onStdoutLine?: (line: string) => void; ignoreExitCode?: boolean } = {},
): Promise<{ stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  ctx.setChild(proc)
  const onAbort = () => proc.kill()
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  let stdoutDone: Promise<void> = Promise.resolve()
  if (opts.onStdoutLine) {
    stdoutDone = (async () => {
      let buf = ''
      for await (const chunk of proc.stdout) {
        buf += new TextDecoder().decode(chunk)
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const l of lines) opts.onStdoutLine!(l)
      }
      if (buf) opts.onStdoutLine!(buf)
    })()
  }
  const stderr = await new Response(proc.stderr).text()
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
