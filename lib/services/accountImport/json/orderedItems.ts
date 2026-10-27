import { StringDecoder } from 'node:string_decoder'

/** One element of the top-level `orderedItems` array: raw text and position. */
export interface OrderedItem {
  index: number
  raw: string
}

/** One element that could not be parsed. */
export interface OrderedItemsError {
  index: number
  error: 'item_too_large' | 'invalid_json'
}

export type OrderedItemsEvent = OrderedItem | OrderedItemsError

/** No single item may buffer past this. */
export const ITEM_MAX_BYTES = 512 * 1024

/**
 * Walks the bytes of an ActivityStreams document, finds the top-level
 * `orderedItems` array and yields the raw text of each element, one at a
 * time, so the whole document is never parsed.
 */
export async function* iterateOrderedItems(
  chunks: AsyncIterable<Buffer>
): AsyncGenerator<OrderedItemsEvent> {
  const scanner = new OrderedItemsScanner()
  const decoder = new StringDecoder('utf8')
  for await (const chunk of chunks) {
    for (const event of scanner.push(decoder.write(chunk))) yield event
  }
  for (const event of scanner.end()) yield event
}

const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/**
 * A char-level scanner over one document. It tracks container depth,
 * strings and escapes everywhere, so a bracket or a comma inside a string
 * or a nested container never ends an element early. Only a string that
 * opens right after the root object's `{` or `,` can be the
 * `orderedItems` key, so a same-named key or value inside a nested object
 * is never mistaken for the top-level one. Inside the array it buffers one
 * element at a time, and never past `ITEM_MAX_BYTES`.
 */
class OrderedItemsScanner {
  private state: 'seek' | 'expectValue' | 'collect' | 'done' = 'seek'
  private depth = 0
  private lastSignificant = ''
  private inString = false
  private escape = false
  private keyBuffer: string | null = null
  private elementChars: string[] = []
  private elementBytes = 0
  private elementDepth = 0
  private oversized = false
  private index = 0
  private events: OrderedItemsEvent[] = []

  push(text: string): OrderedItemsEvent[] {
    for (const ch of text) this.feed(ch)
    const out = this.events
    this.events = []
    return out
  }

  end(): OrderedItemsEvent[] {
    // A stream cut off mid-element still reports what it buffered.
    if (this.state === 'collect') this.finishElement()
    this.state = 'done'
    const out = this.events
    this.events = []
    return out
  }

  private feed(ch: string): void {
    if (this.inString) {
      if (this.state === 'collect') {
        this.pushElementChar(ch)
        if (this.escape) this.escape = false
        else if (ch === '\\') this.escape = true
        else if (ch === '"') this.inString = false
        return
      }
      if (this.escape) {
        this.escape = false
        if (this.keyBuffer !== null) this.keyBuffer += ch
        return
      }
      if (ch === '\\') {
        this.escape = true
        if (this.keyBuffer !== null) this.keyBuffer += ch
        return
      }
      if (ch === '"') {
        this.inString = false
        this.closeString()
        return
      }
      if (this.keyBuffer !== null) this.keyBuffer += ch
      return
    }
    if (ch === '"') {
      this.inString = true
      if (this.state === 'collect') {
        this.pushElementChar(ch)
        return
      }
      if (this.state === 'expectValue') this.state = 'seek'
      this.keyBuffer =
        this.depth === 1 &&
        (this.lastSignificant === '{' || this.lastSignificant === ',')
          ? ''
          : null
      return
    }
    switch (this.state) {
      case 'seek':
        this.seekChar(ch)
        break
      case 'expectValue':
        this.expectValueChar(ch)
        break
      case 'collect':
        this.collectChar(ch)
        break
      case 'done':
        break
    }
  }

  private seekChar(ch: string): void {
    if (ch === '{' || ch === '[') this.depth += 1
    else if (ch === '}' || ch === ']') this.depth -= 1
    if (!isWhitespace(ch)) this.lastSignificant = ch
  }

  private expectValueChar(ch: string): void {
    if (isWhitespace(ch) || ch === ':') return
    if (ch === '[') {
      this.state = 'collect'
      this.elementDepth = 0
      return
    }
    // The value is not an array; resume skipping it from this char on.
    this.state = 'seek'
    this.seekChar(ch)
  }

  private collectChar(ch: string): void {
    if (ch === '{' || ch === '[') {
      this.elementDepth += 1
      this.pushElementChar(ch)
      return
    }
    if (ch === ']' && this.elementDepth === 0) {
      this.finishElement()
      this.state = 'done'
      return
    }
    if (ch === '}' || ch === ']') {
      this.elementDepth -= 1
      this.pushElementChar(ch)
      return
    }
    if (ch === ',' && this.elementDepth === 0) {
      this.finishElement()
      return
    }
    this.pushElementChar(ch)
  }

  private closeString(): void {
    const key = this.keyBuffer
    this.keyBuffer = null
    this.lastSignificant = '"'
    if (this.state === 'seek' && this.depth === 1 && key === 'orderedItems') {
      this.state = 'expectValue'
    }
  }

  private pushElementChar(ch: string): void {
    if (this.oversized) return
    this.elementChars.push(ch)
    this.elementBytes += ch.charCodeAt(0) < 0x80 ? 1 : Buffer.byteLength(ch)
    if (this.elementBytes > ITEM_MAX_BYTES) {
      // Stop buffering: the element is reported and skipped, and the
      // scanner still tracks its structure to resync on the next one.
      this.oversized = true
      this.elementChars = []
    }
  }

  private finishElement(): void {
    const oversized = this.oversized
    const raw = this.elementChars.join('').trim()
    this.elementChars = []
    this.elementBytes = 0
    this.elementDepth = 0
    this.oversized = false
    if (!oversized && raw.length === 0) return
    if (oversized) {
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
  }
}
