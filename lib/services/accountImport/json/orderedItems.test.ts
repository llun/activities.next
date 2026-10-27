import { describe, expect, it } from 'vitest'

import {
  ITEM_MAX_BYTES,
  type IterateOrderedItemsOptions,
  KEY_MAX_CHARS,
  type OrderedItemsEvent,
  OrderedItemsScanner,
  iterateOrderedItems
} from './orderedItems'

/** Collects one iterator's events, in order. */
const collect = async (
  chunks: Buffer[],
  options?: IterateOrderedItemsOptions
): Promise<OrderedItemsEvent[]> => {
  const events: OrderedItemsEvent[] = []
  const source: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    }
  }
  for await (const event of iterateOrderedItems(source, options)) {
    events.push(event)
  }
  return events
}

/** Splits a document into fixed-size byte chunks, as a stream would. */
const chunked = (document: string, size: number): Buffer[] => {
  const bytes = Buffer.from(document)
  const chunks: Buffer[] = []
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size))
  }
  return chunks
}

describe('iterateOrderedItems', () => {
  it('yields the raw text of each element in order', async () => {
    const document =
      '{"@context": "https://example.com", "orderedItems": [{"id": 1}, {"id": 2}], "totalItems": 2}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([
      { index: 0, raw: '{"id": 1}' },
      { index: 1, raw: '{"id": 2}' }
    ])
  })

  it('yields nothing for a document without orderedItems', async () => {
    const events = await collect([Buffer.from('{"id": "x"}')])
    expect(events).toEqual([])
  })

  it('reports an oversized element and still parses the next one', async () => {
    const oversized = JSON.stringify({ text: 'x'.repeat(ITEM_MAX_BYTES + 1) })
    const document = `{"orderedItems": [${JSON.stringify({ id: 1 })}, ${oversized}, ${JSON.stringify({ id: 3 })}]}`
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([
      { index: 0, raw: '{"id":1}' },
      { index: 1, error: 'item_too_large' },
      { index: 2, raw: '{"id":3}' }
    ])
  })

  it('reports a malformed element and still parses the next one', async () => {
    const document = '{"orderedItems": [nope, {"id": 1}]}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([
      { index: 0, error: 'invalid_json' },
      { index: 1, raw: '{"id": 1}' }
    ])
  })

  it('handles escapes and nested arrays inside elements', async () => {
    const document =
      '{"orderedItems": [{"text": "a[\\"b\\", {c}]"}, [1, 2], [[3], {"d": [4]}]]}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([
      { index: 0, raw: '{"text": "a[\\"b\\", {c}]"}' },
      { index: 1, raw: '[1, 2]' },
      { index: 2, raw: '[[3], {"d": [4]}]' }
    ])
  })

  it('does not mistake a nested orderedItems key for the top-level one', async () => {
    const document =
      '{"context": {"orderedItems": [1, 2]}, "orderedItems": [3]}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([{ index: 0, raw: '3' }])
  })

  it('does not mistake an orderedItems value for the top-level key', async () => {
    const document = '{"note": "orderedItems", "orderedItems": [{"id": 1}]}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([{ index: 0, raw: '{"id": 1}' }])
  })

  it('reads elements split across stream chunks', async () => {
    const document =
      '{"orderedItems": [{"id": 1, "text": "a"}, {"id": 2, "text": "b"}]}'
    const events = await collect(chunked(document, 3))
    expect(events).toEqual([
      { index: 0, raw: '{"id": 1, "text": "a"}' },
      { index: 1, raw: '{"id": 2, "text": "b"}' }
    ])
  })

  it('iterates an outbox larger than the item cap without buffering it whole', async () => {
    const count = 700
    const items = Array.from({ length: count }, (_, i) =>
      JSON.stringify({ id: i, text: 'x'.repeat(900) })
    )
    const document = `{"orderedItems": [${items.join(', ')}]}`
    expect(Buffer.byteLength(document)).toBeGreaterThan(ITEM_MAX_BYTES)
    const events = await collect(chunked(document, 4096))
    expect(events).toHaveLength(count)
    expect(events.every((event) => 'raw' in event)).toBe(true)
    expect(
      events.every(
        (event, i) => 'raw' in event && JSON.parse(event.raw).id === i
      )
    ).toBe(true)
  })

  it('does not buffer a multi-megabyte top-level key past the cap', () => {
    const scanner = new OrderedItemsScanner()
    const longKey = 'k'.repeat(4 * 1024 * 1024)
    const events = scanner.push(
      `{"${longKey}": 1, "orderedItems": [${JSON.stringify({ id: 1 })}]}`
    )
    expect(scanner.peakKeyChars).toBeLessThanOrEqual(KEY_MAX_CHARS)
    expect(events).toEqual([{ index: 0, raw: '{"id":1}' }])
  })

  it('still finds orderedItems after a multi-megabyte top-level key', async () => {
    const longKey = 'k'.repeat(4 * 1024 * 1024)
    const document = `{"${longKey}": 1, "orderedItems": [${JSON.stringify({ id: 1 })}, ${JSON.stringify({ id: 2 })}]}`
    const events = await collect(chunked(document, 4096))
    expect(events).toEqual([
      { index: 0, raw: '{"id":1}' },
      { index: 1, raw: '{"id":2}' }
    ])
  })

  it('does not match a key that starts with orderedItems but is longer', async () => {
    const document =
      '{"orderedItemsButLonger": [{"id": 1}], "orderedItems": [{"id": 2}]}'
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([{ index: 0, raw: '{"id": 2}' }])
  })

  it('enforces an injected smaller key cap', async () => {
    const document = '{"orderedItems": [{"id": 1}]}'
    const events = await collect([Buffer.from(document)], {
      maxKeyLength: 4
    })
    expect(events).toEqual([])
  })
})
