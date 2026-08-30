import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { createDeepLProvider } from './deepl'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const deepLConfig = {
  type: 'deepl' as const,
  apiKey: 'deepl-key',
  plan: 'free' as const
}

describe('createDeepLProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('translates HTML content with tag_handling and an uppercased target', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        translations: [
          { detected_source_language: 'EN', text: '<p>Bonjour</p>' }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api-free.deepl.com/v2/translate'
    })

    const provider = createDeepLProvider(deepLConfig)
    const result = await provider.translate(['<p>Hello</p>'], 'fr')

    expect(result).toEqual({
      texts: ['<p>Bonjour</p>'],
      detectedSourceLanguage: 'en',
      provider: 'DeepL.com'
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    expect(callArgs?.url).toBe('https://api-free.deepl.com/v2/translate')
    expect(callArgs?.headers).toEqual({
      Authorization: 'DeepL-Auth-Key deepl-key',
      'Content-Type': 'application/json'
    })
    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body).toEqual({
      text: ['<p>Hello</p>'],
      target_lang: 'FR',
      tag_handling: 'html'
    })
  })

  it('routes pro plans to the paid host', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        translations: [{ detected_source_language: 'EN', text: 'hola' }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.deepl.com/v2/translate'
    })

    const provider = createDeepLProvider({ ...deepLConfig, plan: 'pro' })
    await provider.translate(['hello'], 'es')

    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    expect(callArgs?.url).toBe('https://api.deepl.com/v2/translate')
  })

  it('reads supported source and target languages', async () => {
    vi.mocked(safeRemoteFetch).mockImplementation(async (options) => {
      const isSource = options.url.includes('type=source')
      return {
        statusCode: 200,
        body: JSON.stringify(
          isSource
            ? [{ language: 'EN' }, { language: 'FR' }]
            : [{ language: 'EN-US' }, { language: 'DE' }]
        ),
        bodyTruncated: false,
        headers: {},
        url: options.url
      }
    })

    const provider = createDeepLProvider(deepLConfig)
    const languages = await provider.languages()

    expect(languages.source).toEqual(['en', 'fr'])
    expect(languages.target).toEqual(['en', 'de'])
  })

  it('throws when the backend returns a non-200 status', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 456,
      body: 'nope',
      bodyTruncated: false,
      headers: {},
      url: 'https://api-free.deepl.com/v2/translate'
    })

    const provider = createDeepLProvider(deepLConfig)
    await expect(provider.translate(['hello'], 'fr')).rejects.toThrow(
      /status 456/
    )
  })

  it('throws a TranslationProviderError when the backend returns invalid JSON', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: 'not json',
      bodyTruncated: false,
      headers: {},
      url: 'https://api-free.deepl.com/v2/translate'
    })

    const provider = createDeepLProvider(deepLConfig)
    await expect(provider.translate(['hello'], 'fr')).rejects.toThrow(
      /invalid JSON/
    )
  })

  it('throws when the translation count does not match the input', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ translations: [] }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api-free.deepl.com/v2/translate'
    })

    const provider = createDeepLProvider(deepLConfig)
    await expect(provider.translate(['a', 'b'], 'fr')).rejects.toThrow(
      /unexpected number/
    )
  })
})
