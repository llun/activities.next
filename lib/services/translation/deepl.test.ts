import { createDeepLProvider } from './deepl'
import { TranslationHttpClient, TranslationHttpRequest } from './types'

const deepLConfig = {
  type: 'deepl' as const,
  apiKey: 'deepl-key',
  plan: 'free' as const
}

const createRecordingClient = (
  responder: (request: TranslationHttpRequest) => {
    statusCode: number
    body: string
  }
) => {
  const requests: TranslationHttpRequest[] = []
  const client: TranslationHttpClient = async (request) => {
    requests.push(request)
    return responder(request)
  }
  return { client, requests }
}

describe('createDeepLProvider', () => {
  it('translates HTML content with tag_handling and an uppercased target', async () => {
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({
        translations: [
          { detected_source_language: 'EN', text: '<p>Bonjour</p>' }
        ]
      })
    }))
    const provider = createDeepLProvider(deepLConfig, client)

    const result = await provider.translate(['<p>Hello</p>'], 'fr')

    expect(result).toEqual({
      texts: ['<p>Bonjour</p>'],
      detectedSourceLanguage: 'en',
      provider: 'DeepL.com'
    })

    const [request] = requests
    expect(request.url).toBe('https://api-free.deepl.com/v2/translate')
    expect(request.headers.Authorization).toBe('DeepL-Auth-Key deepl-key')
    const body = JSON.parse(request.body ?? '{}')
    expect(body).toEqual({
      text: ['<p>Hello</p>'],
      target_lang: 'FR',
      tag_handling: 'html'
    })
  })

  it('routes pro plans to the paid host', async () => {
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({
        translations: [{ detected_source_language: 'EN', text: 'hola' }]
      })
    }))
    const provider = createDeepLProvider(
      { ...deepLConfig, plan: 'pro' },
      client
    )

    await provider.translate(['hello'], 'es')

    expect(requests[0]?.url).toBe('https://api.deepl.com/v2/translate')
  })

  it('reads supported source and target languages', async () => {
    const { client } = createRecordingClient((request) => ({
      statusCode: 200,
      body: JSON.stringify(
        request.url.includes('type=source')
          ? [{ language: 'EN' }, { language: 'FR' }]
          : [{ language: 'EN-US' }, { language: 'DE' }]
      )
    }))
    const provider = createDeepLProvider(deepLConfig, client)

    const languages = await provider.languages()

    expect(languages.source).toEqual(['en', 'fr'])
    expect(languages.target).toEqual(['en', 'de'])
  })

  it('throws when the backend returns a non-200 status', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 456,
      body: 'nope'
    }))
    const provider = createDeepLProvider(deepLConfig, client)

    await expect(provider.translate(['hello'], 'fr')).rejects.toThrow(
      /status 456/
    )
  })

  it('throws when the translation count does not match the input', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({ translations: [] })
    }))
    const provider = createDeepLProvider(deepLConfig, client)

    await expect(provider.translate(['a', 'b'], 'fr')).rejects.toThrow(
      /unexpected number/
    )
  })
})
