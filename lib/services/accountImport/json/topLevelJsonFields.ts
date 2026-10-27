import { StringDecoder } from 'node:string_decoder'

import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'

const MAX_FIELD_BYTES = 64 * 1024
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
const MAX_KEY_BYTES = 1024

/** Reads selected root values without buffering or parsing the whole object. */
export async function readTopLevelJsonFields(
  chunks: AsyncIterable<Buffer>,
  selected: readonly string[]
): Promise<Record<string, unknown>> {
  const scanner = new TopLevelJsonFieldsScanner(selected)
  const decoder = new StringDecoder('utf8')
  for await (const chunk of chunks) scanner.push(decoder.write(chunk))
  scanner.push(decoder.end())
  return scanner.finish()
}

export class TopLevelJsonFieldsScanner {
  private readonly fields: Record<string, unknown> = {}
  private state: 'root' | 'key' | 'colon' | 'value' | 'afterValue' = 'root'
  private totalBytes = 0
  private keyRaw = ''
  private keyBytes = 0
  private keyTooLarge = false
  private key: string | null = null
  private valueRaw = ''
  private capture = false
  private valueTooLarge = false
  private inString = false
  private escape = false
  private depth = 0
  private primitive = false
  private valueStarted = false
  private done = false

  constructor(private readonly selected: readonly string[]) {}

  push(text: string): void {
    this.totalBytes += Buffer.byteLength(text)
    if (this.totalBytes > MAX_DOCUMENT_BYTES) {
      throw new ZipArchiveError(
        'entry_too_large',
        'JSON object exceeds the scan limit'
      )
    }
    for (const ch of text) this.feed(ch)
  }

  finish(): Record<string, unknown> {
    return this.fields
  }

  private appendValue(ch: string): void {
    if (!this.capture || this.valueTooLarge) return
    this.valueRaw += ch
    if (Buffer.byteLength(this.valueRaw) > MAX_FIELD_BYTES) {
      this.valueRaw = ''
      this.valueTooLarge = true
    }
  }

  private appendKey(ch: string): void {
    this.keyBytes += Buffer.byteLength(ch)
    if (this.keyBytes > MAX_KEY_BYTES) {
      this.keyTooLarge = true
      this.keyRaw = ''
    } else if (!this.keyTooLarge) {
      this.keyRaw += ch
    }
  }

  private finishValue(): void {
    if (this.key && this.capture && !this.valueTooLarge) {
      try {
        this.fields[this.key] = JSON.parse(this.valueRaw)
      } catch {
        // Malformed selected values remain absent and fail their caller schema.
      }
    }
    this.key = null
    this.valueRaw = ''
    this.capture = false
    this.valueTooLarge = false
    this.valueStarted = false
    this.primitive = false
    this.depth = 0
    this.state = 'afterValue'
  }

  private feed(ch: string): void {
    if (this.done) return
    if (this.state === 'root') {
      if (/\s/.test(ch)) return
      if (ch !== '{') return
      this.state = 'key'
      return
    }
    if (this.state === 'key') {
      if (/\s|,/.test(ch)) return
      if (ch === '}') {
        this.done = true
        return
      }
      if (ch !== '"') return
      this.keyRaw = ''
      this.keyBytes = 0
      this.keyTooLarge = false
      this.inString = true
      this.escape = false
      this.state = 'colon'
      return
    }
    if (this.state === 'colon' && this.inString && this.key === null) {
      this.appendKey(ch)
      if (this.escape) this.escape = false
      else if (ch === '\\') this.escape = true
      else if (ch === '"') {
        this.inString = false
        if (!this.keyTooLarge) {
          try {
            this.key = JSON.parse(`"${this.keyRaw.slice(0, -1)}"`) as string
          } catch {
            this.key = null
          }
        }
      }
      return
    }
    if (this.state === 'colon') {
      if (/\s/.test(ch)) return
      if (ch !== ':') return
      this.state = 'value'
      return
    }
    if (this.state === 'value') {
      if (!this.valueStarted && /\s/.test(ch)) return
      if (!this.valueStarted) {
        this.valueStarted = true
        this.capture = Boolean(this.key && this.selected.includes(this.key))
        this.primitive = ch !== '{' && ch !== '['
        if (ch === '"') {
          this.inString = true
          this.escape = false
        } else if (ch === '{' || ch === '[') {
          this.depth = 1
        }
        this.appendValue(ch)
        return
      }
      if (this.inString) {
        this.appendValue(ch)
        if (this.escape) this.escape = false
        else if (ch === '\\') this.escape = true
        else if (ch === '"') this.inString = false
        return
      }
      if (this.depth > 0) {
        this.appendValue(ch)
        if (ch === '"') {
          this.inString = true
          this.escape = false
        } else if (ch === '{' || ch === '[') this.depth += 1
        else if (ch === '}' || ch === ']') this.depth -= 1
        if (this.depth === 0) this.finishValue()
        return
      }
      if (this.primitive && (ch === ',' || ch === '}')) {
        this.finishValue()
        if (ch === '}') this.done = true
        else this.state = 'key'
        return
      }
      this.appendValue(ch)
      if (!this.inString && !this.primitive) this.finishValue()
      return
    }
    if (this.state === 'afterValue') {
      if (/\s/.test(ch)) return
      if (ch === ',') this.state = 'key'
      else if (ch === '}') this.done = true
    }
  }
}
