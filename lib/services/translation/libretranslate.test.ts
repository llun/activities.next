import { createLibreTranslateProvider } from './libretranslate'
import { TranslationHttpClient, TranslationHttpRequest } from './types'

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

describe('createLibreTranslateProvider', () => {
  const config = {
    type: 'libretranslate' as const,
    endpoint: 'http://libretranslate:5000/'
  }

  it('translates with format=html, source=auto and a trimmed endpoint', async () => {
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({
        translatedText: ['<p>Hallo</p>'],
        detectedLanguage: [{ confidence: 90, language: 'en' }]
      })
    }))
    const provider = createLibreTranslateProvider(config, client)

    const result = await provider.translate(['<p>Hello</p>'], 'de')

    expect(result).toEqual({
      texts: ['<p>Hallo</p>'],
      detectedSourceLanguage: 'en',
      provider: 'LibreTranslate'
    })

    const [request] = requests
    expect(request.url).toBe('http://libretranslate:5000/translate')
    const body = JSON.parse(request.body ?? '{}')
    expect(body).toEqual({
      q: ['<p>Hello</p>'],
      source: 'auto',
      target: 'de',
      format: 'html'
    })
  })

  it('includes the api key when configured', async () => {
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({
        translatedText: ['x'],
        detectedLanguage: [{ language: 'en' }]
      })
    }))
    const provider = createLibreTranslateProvider(
      { ...config, apiKey: 'libre-key' },
      client
    )

    await provider.translate(['hello'], 'de')

    expect(JSON.parse(requests[0]?.body ?? '{}').api_key).toBe('libre-key')
  })

  it('accepts an older single-string response for a single-item batch', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({
        translatedText: '<p>Hallo</p>',
        detectedLanguage: { confidence: 90, language: 'en' }
      })
    }))
    const provider = createLibreTranslateProvider(config, client)

    const result = await provider.translate(['<p>Hello</p>'], 'de')

    expect(result.texts).toEqual(['<p>Hallo</p>'])
    expect(result.detectedSourceLanguage).toBe('en')
  })

  it('lists languages as both source and target', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify([{ code: 'en' }, { code: 'de' }, { code: 'fr' }])
    }))
    const provider = createLibreTranslateProvider(config, client)

    const languages = await provider.languages()

    expect(languages.source).toEqual(['en', 'de', 'fr'])
    expect(languages.target).toEqual(['en', 'de', 'fr'])
  })

  it('throws when the translation count does not match the input', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: JSON.stringify({ translatedText: ['only one'] })
    }))
    const provider = createLibreTranslateProvider(config, client)

    await expect(provider.translate(['a', 'b'], 'de')).rejects.toThrow(
      /unexpected number/
    )
  })
})
