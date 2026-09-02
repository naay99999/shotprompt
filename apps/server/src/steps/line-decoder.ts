export class LineDecoder {
  private decoder = new TextDecoder()
  private buffered = ''

  push(chunk: Uint8Array): string[] {
    this.buffered += this.decoder.decode(chunk, { stream: true })
    return this.takeLines()
  }

  finish(): string[] {
    this.buffered += this.decoder.decode()
    const lines = this.takeLines()
    if (this.buffered) lines.push(this.buffered)
    this.buffered = ''
    return lines
  }

  private takeLines(): string[] {
    const parts = this.buffered.split('\n')
    this.buffered = parts.pop() ?? ''
    return parts
  }
}
