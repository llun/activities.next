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
})
