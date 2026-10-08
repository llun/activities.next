import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants'

import { logger } from '@/lib/utils/logger'

import { getGalleryConfig } from './gallery'

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const altText = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const KEYS = [
  'ACTIVITIES_GALLERY_SUBJECTS',
  'ACTIVITIES_GALLERY_SUBJECTS_MODEL',
  'ACTIVITIES_GALLERY_GBIF_ENDPOINT',
  'ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT',
  'ACTIVITIES_GALLERY_NOMINATIM_EMAIL',
  'NEXT_PHASE'
]

describe('getGalleryConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of KEYS) delete process.env[key]
    vi.mocked(logger.warn).mockClear()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('applies the public defaults', () => {
    expect(getGalleryConfig(altText).gallery).toEqual({
      subjects: {
        endpoint: altText.endpoint,
        apiKey: 'sk-test',
        model: 'gpt-4o-mini'
      },
      gbif: { endpoint: 'https://api.gbif.org/v1' },
      nominatim: {
        endpoint: 'https://nominatim.openstreetmap.org',
        email: null
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('has no subjects config without alt text', () => {
    expect(getGalleryConfig(null).gallery.subjects).toBeNull()
    expect(getGalleryConfig(undefined).gallery.subjects).toBeNull()
  })

  it('overrides the model for subjects only', () => {
    process.env.ACTIVITIES_GALLERY_SUBJECTS_MODEL = 'gpt-4o'
    expect(getGalleryConfig(altText).gallery.subjects?.model).toBe('gpt-4o')
  })

  it('turns subjects off with ACTIVITIES_GALLERY_SUBJECTS=off', () => {
    process.env.ACTIVITIES_GALLERY_SUBJECTS = 'off'
    expect(getGalleryConfig(altText).gallery.subjects).toBeNull()
  })

  it('reads custom endpoints and the Nominatim email', () => {
    process.env.ACTIVITIES_GALLERY_GBIF_ENDPOINT =
      'https://gbif.example.com/v1/'
    process.env.ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT =
      'https://geo.example.com'
    process.env.ACTIVITIES_GALLERY_NOMINATIM_EMAIL = ' ops@example.com '

    expect(getGalleryConfig(altText).gallery).toMatchObject({
      gbif: { endpoint: 'https://gbif.example.com/v1' },
      nominatim: {
        endpoint: 'https://geo.example.com',
        email: 'ops@example.com'
      }
    })
  })

  it.each([
    ['not a url'],
    ['http://10.0.0.1'],
    ['https://user:pass@geo.example.com'],
    ['ftp://geo.example.com']
  ])('falls back with one warning for %s', (value) => {
    process.env.ACTIVITIES_GALLERY_GBIF_ENDPOINT = value

    expect(getGalleryConfig(altText).gallery.gbif.endpoint).toBe(
      'https://api.gbif.org/v1'
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('does not throw or warn during the production build phase', () => {
    process.env.NEXT_PHASE = PHASE_PRODUCTION_BUILD
    process.env.ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT = 'http://10.0.0.1'

    expect(() => getGalleryConfig(altText)).not.toThrow()
    expect(getGalleryConfig(altText).gallery.nominatim.endpoint).toBe(
      'https://nominatim.openstreetmap.org'
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
