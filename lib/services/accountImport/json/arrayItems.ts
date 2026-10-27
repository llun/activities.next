import { StringDecoder } from 'node:string_decoder'

import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'

export const ARRAY_ITEM_MAX_BYTES = 512 * 1024
const ARRAY_DOCUMENT_MAX_BYTES = 256 * 1024 * 1024

export type ArrayItemEvent =
  | { index: number; raw: string }
  | { index: number; error: 'item_too_large' | 'invalid_json' }

/** Reads a root JSON array one bounded element at a time. */
export async function* iterateArrayItems(
  chunks: AsyncIterable<Buffer>
): AsyncGenerator<ArrayItemEvent> {
  const scanner = new ArrayItemsScanner()
  const decoder = new StringDecoder('utf8')
  for await (const chunk of chunks) {
    for (const event of scanner.push(decoder.write(chunk))) yield event
  }
  for (const event of scanner.push(decoder.end())) yield event
  for (const event of scanner.end()) yield event
}

class ArrayItemsScanner {
  private state: 'root' | 'value' | 'collect' | 'done' = 'root'
  private totalBytes = 0
  private depth = 0
  private inString = false
  private escape = false
  private container = false
  private raw: string[] = []
  private rawBytes = 0
  private oversized = false
  private index = 0
  private events: ArrayItemEvent[] = []

  push(text: string): ArrayItemEvent[] {
    this.totalBytes += Buffer.byteLength(text)
    if (this.totalBytes > ARRAY_DOCUMENT_MAX_BYTES) {
      throw new ZipArchiveError(
        'entry_too_large',
        'JSON array exceeds scan limit'
      )
    }
    for (const ch of text) this.feed(ch)
    const events = this.events
    this.events = []
    return events
  }

  end(): ArrayItemEvent[] {
    if (this.state === 'collect') this.finishItem()
    const events = this.events
    this.events = []
    this.state = 'done'
    return events
  }

  private feed(ch: string): void {
    if (this.state === 'done') return
    if (this.state === 'root') {
      if (/\s/.test(ch)) return
      if (ch !== '[') {
        this.state = 'done'
        return
      }
      this.state = 'value'
      return
    }
    if (this.state === 'value') {
      if (/\s|,/.test(ch)) return
      if (ch === ']') {
        this.state = 'done'
        return
      }
      this.state = 'collect'
      this.raw = []
      this.rawBytes = 0
      this.oversized = false
      this.container = ch === '{' || ch === '['
      this.depth = this.container ? 1 : 0
      this.inString = ch === '"'
      this.escape = false
      this.append(ch)
      return
    }
    if (!this.container && !this.inString && (ch === ',' || ch === ']')) {
      this.finishItem()
      if (ch === ']') this.state = 'done'
      return
    }
    if (this.inString) {
      this.append(ch)
      if (this.escape) this.escape = false
      else if (ch === '\\') this.escape = true
      else if (ch === '"') this.inString = false
      return
    }
    if (ch === '"') {
      this.inString = true
      this.append(ch)
      return
    }
    if (this.container) {
      if (ch === '{' || ch === '[') this.depth += 1
      else if (ch === '}' || ch === ']') this.depth -= 1
      if (this.depth === 0) {
        this.append(ch)
        this.finishItem()
        return
      }
    }
    this.append(ch)
  }

  private append(ch: string): void {
    this.rawBytes += Buffer.byteLength(ch)
    if (this.rawBytes > ARRAY_ITEM_MAX_BYTES) {
      this.raw = []
      this.oversized = true
      return
    }
    if (!this.oversized) this.raw.push(ch)
  }

  private finishItem(): void {
    const raw = this.raw.join('').trim()
    if (this.oversized) {
      this.events.push({ index: this.index, error: 'item_too_large' })
    } else {
      try {
        JSON.parse(raw)
        this.events.push({ index: this.index, raw })
      } catch {
        this.events.push({ index: this.index, error: 'invalid_json' })
      }
    }
    this.index += 1
    this.raw = []
    this.rawBytes = 0
    this.oversized = false
    this.container = false
    this.state = 'value'
  }
}
