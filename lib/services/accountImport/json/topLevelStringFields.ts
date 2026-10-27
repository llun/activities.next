import { StringDecoder } from 'node:string_decoder'

import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'

export const TOP_LEVEL_STRING_FIELDS_KEY_MAX_BYTES = 1024
export const TOP_LEVEL_STRING_FIELDS_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024

type ScannerState = 'root' | 'key' | 'colon' | 'value' | 'afterValue'

/** Reads selected string-valued root fields without parsing the whole entry. */
export class TopLevelStringFieldsScanner {
  private readonly decoder = new StringDecoder('utf8')
  private readonly fields: Record<string, string> = {}
  private state: ScannerState = 'root'
  private rootStarted = false
  private keyRaw = ''
  private key: string | null = null
  private keyBytes = 0
  private keyTooLarge = false
  private valueRaw = ''
  private captureValue = false
  private valueTooLarge = false
  private valueStarted = false
  private depth = 0
  private inString = false
  private escape = false
  private primitive = false
  private done = false
  private finished = false
  private totalBytes = 0
  peakKeyBytes = 0

  constructor(
    private readonly selected: readonly string[],
    private readonly maxFieldBytes = 8 * 1024,
    private readonly maxKeyBytes = TOP_LEVEL_STRING_FIELDS_KEY_MAX_BYTES,
    private readonly maxDocumentBytes = TOP_LEVEL_STRING_FIELDS_DOCUMENT_MAX_BYTES
  ) {}

  push(chunk: Buffer): void {
    this.totalBytes += chunk.length
    if (this.totalBytes > this.maxDocumentBytes) {
      throw new ZipArchiveError(
        'entry_too_large',
        'actor.json exceeds the scan limit'
      )
    }
    if (!this.finished) this.feed(this.decoder.write(chunk))
  }

  finish(): Record<string, string> {
    if (!this.finished) {
      this.feed(this.decoder.end())
      this.finished = true
    }
    return this.fields
  }

  private appendKey(ch: string): void {
    if (this.keyTooLarge) return
    const bytes = Buffer.byteLength(ch, 'utf8')
    if (this.keyBytes + bytes > this.maxKeyBytes) {
      this.keyRaw = ''
      this.keyTooLarge = true
      return
    }
    this.keyRaw += ch
    this.keyBytes += bytes
    this.peakKeyBytes = Math.max(this.peakKeyBytes, this.keyBytes)
  }

  private finishValue(): void {
    if (this.key && this.captureValue && !this.valueTooLarge) {
      try {
        const value: unknown = JSON.parse(this.valueRaw)
        if (typeof value === 'string') this.fields[this.key] = value
      } catch {
        // A malformed field is left absent and rejected by the caller schema.
      }
    }
    this.key = null
    this.keyRaw = ''
    this.keyBytes = 0
    this.keyTooLarge = false
    this.valueRaw = ''
    this.captureValue = false
    this.valueTooLarge = false
    this.valueStarted = false
    this.primitive = false
    this.state = 'afterValue'
  }

  private feed(text: string): void {
    for (const ch of text) {
      if (this.done) continue
      if (!this.rootStarted) {
        if (/\s/.test(ch)) continue
        if (ch !== '{')
          throw new ZipArchiveError('not_a_zip', 'Invalid actor document')
        this.rootStarted = true
        this.state = 'key'
        continue
      }
      if (this.state === 'key') {
        if (/\s|,/.test(ch)) continue
        if (ch === '}') {
          this.done = true
          continue
        }
        if (ch !== '"')
          throw new ZipArchiveError('not_a_zip', 'Invalid actor document')
        this.keyRaw = '"'
        this.keyBytes = 1
        this.keyTooLarge = this.keyBytes > this.maxKeyBytes
        if (this.keyTooLarge) this.keyRaw = ''
        else this.peakKeyBytes = Math.max(this.peakKeyBytes, this.keyBytes)
        this.inString = true
        this.escape = false
        this.state = 'colon'
        continue
      }
      if (this.state === 'colon' && this.key === null && this.inString) {
        this.appendKey(ch)
        if (this.escape) this.escape = false
        else if (ch === '\\') this.escape = true
        else if (ch === '"') {
          this.inString = false
          if (!this.keyTooLarge) {
            try {
              this.key = JSON.parse(this.keyRaw) as string
            } catch {
              throw new ZipArchiveError('not_a_zip', 'Invalid actor document')
            }
          }
        }
        continue
      }
      if (this.state === 'colon') {
        if (/\s/.test(ch)) continue
        if (ch !== ':')
          throw new ZipArchiveError('not_a_zip', 'Invalid actor document')
        this.state = 'value'
        continue
      }
      if (this.state === 'value') {
        if (!this.valueStarted && /\s/.test(ch)) continue
        if (!this.valueStarted) {
          this.valueStarted = true
          this.captureValue = Boolean(
            this.key && this.selected.includes(this.key)
          )
          if (ch === '"') {
            this.inString = true
            this.escape = false
          } else if (ch === '{' || ch === '[') {
            this.depth = 1
          } else {
            this.primitive = true
          }
        } else if (this.inString) {
          if (this.escape) this.escape = false
          else if (ch === '\\') this.escape = true
          else if (ch === '"') this.inString = false
        } else if (this.depth > 0) {
          if (ch === '"') {
            this.inString = true
            this.escape = false
          } else if (ch === '{' || ch === '[') this.depth += 1
          else if (ch === '}' || ch === ']') this.depth -= 1
        } else if (this.primitive && (ch === ',' || ch === '}')) {
          this.finishValue()
          if (ch === '}') this.done = true
          else this.state = 'key'
          continue
        }
        if (this.captureValue && !this.valueTooLarge) {
          this.valueRaw += ch
          if (Buffer.byteLength(this.valueRaw) > this.maxFieldBytes) {
            this.valueRaw = ''
            this.valueTooLarge = true
          }
        }
        if (!this.inString && this.depth === 0 && !this.primitive) {
          this.finishValue()
        }
        continue
      }
      if (this.state === 'afterValue') {
        if (/\s/.test(ch)) continue
        if (ch === ',') this.state = 'key'
        else if (ch === '}') this.done = true
        else throw new ZipArchiveError('not_a_zip', 'Invalid actor document')
      }
    }
  }
}

export const readTopLevelStringFields = async (
  chunks: AsyncIterable<Buffer>,
  selected: readonly string[],
  maxFieldBytes = 8 * 1024
): Promise<Record<string, string>> => {
  const scanner = new TopLevelStringFieldsScanner(selected, maxFieldBytes)
  for await (const chunk of chunks) scanner.push(chunk)
  return scanner.finish()
}
