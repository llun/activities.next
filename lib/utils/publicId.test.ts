import {
  generatePublicId,
  getClientActorId,
  getClientStatusId,
  getPublicIdTimestamp,
  isPublicId
} from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

describe('generatePublicId', () => {
  it('generates a v7 uuid', () => {
    const id = generatePublicId()
    expect(isPublicId(id)).toBe(true)
  })

  it('embeds the supplied timestamp in the first 48 bits', () => {
    const timestamp = Date.UTC(2024, 0, 2, 3, 4, 5, 678)
    const id = generatePublicId(timestamp)
    expect(getPublicIdTimestamp(id)).toBe(timestamp)
  })

  it('sorts lexicographically in chronological order', () => {
    const older = generatePublicId(1_000_000_000_000)
    const newer = generatePublicId(1_000_000_100_000)
    expect(older < newer).toBe(true)
  })

  it.each([
    { description: 'negative timestamp', value: -5 },
    { description: 'NaN timestamp', value: Number.NaN },
    { description: 'Infinity timestamp', value: Number.POSITIVE_INFINITY }
  ])('clamps an invalid timestamp to 0 ($description)', ({ value }) => {
    const id = generatePublicId(value)
    expect(isPublicId(id)).toBe(true)
    expect(getPublicIdTimestamp(id)).toBe(0)
  })
})

describe('isPublicId', () => {
  it.each([
    {
      description: 'v4 uuid (crypto.randomUUID shape)',
      value: crypto.randomUUID()
    },
    {
      description: 'colon-form legacy id',
      value: 'llun.test:users:test1:statuses:post-1'
    },
    { description: 'apurl_ opaque id', value: 'apurl_aHR0cHM6Ly9sbHVuLnRlc3Q' },
    { description: '64-hex url hash', value: 'a'.repeat(64) },
    {
      description: 'full url',
      value: 'https://llun.test/users/test1/statuses/x'
    },
    { description: 'empty string', value: '' },
    {
      description: 'v7 with wrong variant nibble',
      value: '0192b4b0-0000-7000-c000-000000000000'
    }
  ])('rejects non-v7 input ($description)', ({ value }) => {
    expect(isPublicId(value)).toBe(false)
  })

  it('accepts uppercase v7 input', () => {
    expect(isPublicId(generatePublicId().toUpperCase())).toBe(true)
  })
})

describe('getClientStatusId', () => {
  it('prefers publicId when present', () => {
    const id = generatePublicId()
    expect(
      getClientStatusId({
        id: 'https://llun.test/users/a/statuses/1',
        publicId: id
      })
    ).toBe(id)
  })

  it.each([
    { description: 'null publicId', publicId: null },
    { description: 'absent publicId', publicId: undefined }
  ])('falls back to urlToId ($description)', ({ publicId }) => {
    const uri = 'https://llun.test/users/a/statuses/1'
    expect(getClientStatusId({ id: uri, publicId })).toBe(urlToId(uri))
  })
})

describe('getClientActorId', () => {
  it('behaves like getClientStatusId for actors', () => {
    const uri = 'https://llun.test/users/a'
    expect(getClientActorId({ id: uri, publicId: null })).toBe(urlToId(uri))
    const id = generatePublicId()
    expect(getClientActorId({ id: uri, publicId: id })).toBe(id)
  })
})
