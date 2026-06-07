import { LLM_SUPPORTED_LANGUAGES } from './languages'
import { createOpenAIProvider } from './openai'
import { TranslationHttpClient, TranslationHttpRequest } from './types'

const config = {
  type: 'openai' as const,
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const chatResponse = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] })

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

describe('createOpenAIProvider', () => {
  it('uses the model in the cache key but the model name as provider', () => {
    const provider = createOpenAIProvider(config, async () => ({
      statusCode: 200,
      body: ''
    }))

    expect(provider.cacheKey).toBe('openai:gpt-4o-mini')
    expect(provider.providerName).toBe('gpt-4o-mini')
  })

  it('advertises the broad fixed language list', async () => {
    const provider = createOpenAIProvider(config, async () => ({
      statusCode: 200,
      body: ''
    }))

    const languages = await provider.languages()

    expect(languages.source).toEqual([...LLM_SUPPORTED_LANGUAGES])
    expect(languages.target).toEqual([...LLM_SUPPORTED_LANGUAGES])
  })

  it('parses the structured JSON translation response', async () => {
    const { client, requests } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse(
        JSON.stringify({
          translations: ['<p>Hola</p>', 'Aviso'],
          detected_source_language: 'EN'
        })
      )
    }))
    const provider = createOpenAIProvider(config, client)

    const result = await provider.translate(['<p>Hi</p>', 'Warning'], 'es')

    expect(result).toEqual({
      texts: ['<p>Hola</p>', 'Aviso'],
      detectedSourceLanguage: 'en',
      provider: 'gpt-4o-mini'
    })

    const body = JSON.parse(requests[0]?.body ?? '{}')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(requests[0]?.headers.Authorization).toBe('Bearer sk-test')
  })

  it('throws when the model returns a mismatched translation count', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse(
        JSON.stringify({
          translations: ['only one'],
          detected_source_language: 'en'
        })
      )
    }))
    const provider = createOpenAIProvider(config, client)

    await expect(provider.translate(['a', 'b'], 'es')).rejects.toThrow(
      /unexpected shape/
    )
  })

  it('throws when the model response is not valid JSON', async () => {
    const { client } = createRecordingClient(() => ({
      statusCode: 200,
      body: chatResponse('not json')
    }))
    const provider = createOpenAIProvider(config, client)

    await expect(provider.translate(['a'], 'es')).rejects.toThrow(
      /not valid JSON/
    )
  })
})
