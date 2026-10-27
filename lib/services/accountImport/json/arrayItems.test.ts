import { describe, expect, it } from 'vitest'

import {
  ARRAY_ITEM_MAX_BYTES,
  iterateArrayItems
} from '@/lib/services/accountImport/json/arrayItems'

const collect = async (chunks: Buffer[]) => {
  const events = []
  const source: AsyncIterable<Buffer> = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
  for await (const event of iterateArrayItems(source)) events.push(event)
  return events
}

describe('iterateArrayItems', () => {
  it('streams root array elements in order, including nested data and strings', async () => {
    const json = '[{"id":1,"text":"a,[b]"},[2,{"id":3}],"last"]'

    expect(await collect([Buffer.from(json)])).toEqual([
      { index: 0, raw: '{"id":1,"text":"a,[b]"}' },
      { index: 1, raw: '[2,{"id":3}]' },
      { index: 2, raw: '"last"' }
    ])
  })

  it('bounds each element and continues after an oversized item', async () => {
    const oversized = JSON.stringify({ text: 'x'.repeat(ARRAY_ITEM_MAX_BYTES) })
    const json = `[${oversized},{"ok":true}]`

    expect(await collect([Buffer.from(json)])).toEqual([
      { index: 0, error: 'item_too_large' },
      { index: 1, raw: '{"ok":true}' }
    ])
  })
})
