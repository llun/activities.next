import { describe, expect, it } from 'vitest'

import { type JsonlEvent, LINE_MAX_BYTES, iterateJsonlLines } from './jsonl'

/** Collects one iterator's events, in order. */
const collect = async (chunks: Buffer[]): Promise<JsonlEvent[]> => {
  const events: JsonlEvent[] = []
  const source: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    }
  }
  for await (const event of iterateJsonlLines(source)) events.push(event)
  return events
}

describe('iterateJsonlLines', () => {
  it('yields the raw text of each line', async () => {
    const events = await collect([Buffer.from('{"a": 1}\n{"a": 2}\n')])
    expect(events).toEqual([
      { index: 0, raw: '{"a": 1}' },
      { index: 1, raw: '{"a": 2}' }
    ])
  })

  it('skips blank lines', async () => {
    const events = await collect([Buffer.from('{"a": 1}\n\n{"a": 2}\n')])
    expect(events).toEqual([
      { index: 0, raw: '{"a": 1}' },
      { index: 1, raw: '{"a": 2}' }
    ])
  })

  it('reports a malformed line', async () => {
    const events = await collect([Buffer.from('nope\n{"a": 1}\n')])
    expect(events).toEqual([
      { index: 0, error: 'invalid_json' },
      { index: 1, raw: '{"a": 1}' }
    ])
  })

  it('reports an oversized line and still parses the next one', async () => {
    const oversized = JSON.stringify({ text: 'x'.repeat(LINE_MAX_BYTES + 1) })
    const document = `{"a": 1}\n${oversized}\n{"a": 2}\n`
    const events = await collect([Buffer.from(document)])
    expect(events).toEqual([
      { index: 0, raw: '{"a": 1}' },
      { index: 1, error: 'item_too_large' },
      { index: 2, raw: '{"a": 2}' }
    ])
  })

  it('counts a trailing line without its newline', async () => {
    const events = await collect([Buffer.from('{"a": 1}\n{"a": 2}')])
    expect(events).toEqual([
      { index: 0, raw: '{"a": 1}' },
      { index: 1, raw: '{"a": 2}' }
    ])
  })

  it('reads lines split across stream chunks', async () => {
    const document = Buffer.from('{"a": 1}\n{"a": 2}\n')
    const events = await collect([
      document.subarray(0, 5),
      document.subarray(5, 9),
      document.subarray(9)
    ])
    expect(events).toEqual([
      { index: 0, raw: '{"a": 1}' },
      { index: 1, raw: '{"a": 2}' }
    ])
  })
})
