import { describe, expect, it } from 'vitest'

import { readTopLevelJsonFields } from '@/lib/services/accountImport/json/topLevelJsonFields'

describe('readTopLevelJsonFields', () => {
  it('reads only selected root values without confusing nested keys', async () => {
    const json =
      '{"nested":{"galleryDefault":"never"},"galleryDefault":true,"hiddenLocations":[{"latitude":1,"longitude":2,"hideRadiusMeters":50}],"unused":"x"}'
    const chunks: AsyncIterable<Buffer> = {
      async *[Symbol.asyncIterator]() {
        const bytes = Buffer.from(json)
        yield bytes.subarray(0, 25)
        yield bytes.subarray(25)
      }
    }

    await expect(
      readTopLevelJsonFields(chunks, ['galleryDefault', 'hiddenLocations'])
    ).resolves.toEqual({
      galleryDefault: true,
      hiddenLocations: [{ latitude: 1, longitude: 2, hideRadiusMeters: 50 }]
    })
  })

  it('rejects a root document that exceeds the scan cap', async () => {
    const chunks: AsyncIterable<Buffer> = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"id":1}')
        yield Buffer.alloc(4 * 1024 * 1024, 0x20)
      }
    }

    await expect(readTopLevelJsonFields(chunks, ['id'])).rejects.toMatchObject({
      reason: 'entry_too_large'
    })
  })
})
