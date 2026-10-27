import { StringDecoder } from 'node:string_decoder'

/** One line of a JSONL document: raw text and position. */
export interface JsonlLine {
  index: number
  raw: string
}

/** One line that could not be parsed. */
export interface JsonlError {
  index: number
  error: 'item_too_large' | 'invalid_json'
}

export type JsonlEvent = JsonlLine | JsonlError

/** No single line may buffer past this. */
export const LINE_MAX_BYTES = 512 * 1024

/**
 * Walks the bytes of a JSONL document and yields the raw text of each line,
 * one at a time. A line longer than `LINE_MAX_BYTES` is reported and skipped
 * without buffering the rest of it.
 */
export async function* iterateJsonlLines(
  chunks: AsyncIterable<Buffer>
): AsyncGenerator<JsonlLine | JsonlError> {
  const scanner = new JsonlScanner()
  const decoder = new StringDecoder('utf8')
  for await (const chunk of chunks) {
    for (const event of scanner.push(decoder.write(chunk))) yield event
  }
  for (const event of scanner.end()) yield event
}

class JsonlScanner {
  private lineBuffer: string[] = []
  private lineLength = 0
  private oversized = false
  private index = 0
  private events: (JsonlLine | JsonlError)[] = []

  push(text: string): (JsonlLine | JsonlError)[] {
    for (const ch of text) this.feed(ch)
    const out = this.events
    this.events = []
    return out
  }

  end(): (JsonlLine | JsonlError)[] {
    // A final line without its newline still counts.
    this.feed('\n')
    const out = this.events
    this.events = []
    return out
  }

  private feed(ch: string): void {
    if (ch === '\n') {
      this.finishLine()
      return
    }
    if (this.oversized) return
    this.lineBuffer.push(ch)
    this.lineLength += 1
    if (this.lineLength > LINE_MAX_BYTES) {
      this.oversized = true
    }
  }

  private finishLine(): void {
    const oversized = this.oversized
    const raw = this.lineBuffer.join('').replace(/\r$/, '').trim()
    this.lineBuffer = []
    this.lineLength = 0
    this.oversized = false
    if (raw.length === 0) return
    if (oversized) {
      this.events.push({ index: this.index, error: 'item_too_large' })
      this.index += 1
      return
    }
    try {
      JSON.parse(raw)
      this.events.push({ index: this.index, raw })
      this.index += 1
    } catch {
      this.events.push({ index: this.index, error: 'invalid_json' })
      this.index += 1
    }
  }
}
