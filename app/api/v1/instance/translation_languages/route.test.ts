import { NextRequest } from 'next/server'

import { getTranslationProvider } from '@/lib/services/translation'

import { GET } from './route'

vi.mock('@/lib/services/translation', () => ({
  getTranslationProvider: vi.fn()
}))

const request = () =>
  new NextRequest('https://llun.test/api/v1/instance/translation_languages')

describe('GET /api/v1/instance/translation_languages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an empty map when no backend is configured', async () => {
    ;(getTranslationProvider as jest.Mock).mockReturnValue(null)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('maps every source language to the supported targets', async () => {
    ;(getTranslationProvider as jest.Mock).mockReturnValue({
      async languages() {
        return { source: ['en', 'de'], target: ['en', 'de', 'fr'] }
      }
    })

    const response = await GET(request())

    expect(await response.json()).toEqual({
      en: ['en', 'de', 'fr'],
      de: ['en', 'de', 'fr']
    })
  })

  it('falls back to an empty map when the backend cannot report languages', async () => {
    ;(getTranslationProvider as jest.Mock).mockReturnValue({
      async languages() {
        throw new Error('backend down')
      }
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })
})
