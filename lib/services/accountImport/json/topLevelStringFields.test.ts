import {
  TopLevelStringFieldsScanner,
  readTopLevelStringFields
} from './topLevelStringFields'

describe('readTopLevelStringFields', () => {
  it('does not buffer a huge key and still reads selected fields', () => {
    const key = 'x'.repeat(1024 * 1024)
    const bytes = Buffer.from(`{"${key}":1,"id":"source-actor"}`)
    const scanner = new TopLevelStringFieldsScanner(['id'])

    for (let offset = 0; offset < bytes.length; offset += 4096) {
      scanner.push(bytes.subarray(offset, offset + 4096))
    }

    expect(scanner.finish()).toEqual({ id: 'source-actor' })
    expect(scanner.peakKeyBytes).toBeGreaterThan(0)
    expect(scanner.peakKeyBytes).toBeLessThanOrEqual(1024)
  })

  it('refuses to scan actor JSON past the total byte cap with a reason code', async () => {
    const chunks: AsyncIterable<Buffer> = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"id":"source-actor"}')
        yield Buffer.alloc(4 * 1024 * 1024, 0x20)
      }
    }

    await expect(
      readTopLevelStringFields(chunks, ['id'])
    ).rejects.toMatchObject({ reason: 'entry_too_large' })
  })
})
