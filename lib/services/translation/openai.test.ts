import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { LLM_SUPPORTED_LANGUAGES } from './languages'
import { createOpenAIProvider } from './openai'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const config = {
  type: 'openai' as const,
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const chatResponse = (content: string) =>
  JSON.stringify({ choices: [{ message: { content } }] })

describe('createOpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the model in the cache key but the model name as provider', () => {
    const provider = createOpenAIProvider(config)

    expect(provider.cacheKey).toBe('openai:gpt-4o-mini')
    expect(provider.providerName).toBe('gpt-4o-mini')
  })

  it('advertises the broad fixed language list', async () => {
    const provider = createOpenAIProvider(config)

    const languages = await provider.languages()

    expect(languages.source).toEqual([...LLM_SUPPORTED_LANGUAGES])
    expect(languages.target).toEqual([...LLM_SUPPORTED_LANGUAGES])
  })

  it('parses the structured JSON translation response', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(
        JSON.stringify({
          translations: ['<p>Hola</p>', 'Aviso'],
          detected_source_language: 'EN'
        })
      ),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const provider = createOpenAIProvider(config)
    const result = await provider.translate(['<p>Hi</p>', 'Warning'], 'es')

    expect(result).toEqual({
      texts: ['<p>Hola</p>', 'Aviso'],
      detectedSourceLanguage: 'en',
      provider: 'gpt-4o-mini'
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(safeRemoteFetch).mock.calls[0]?.[0]
    expect(callArgs?.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json'
    })

    const body = JSON.parse(callArgs?.body ?? '{}')
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('throws when the model returns a mismatched translation count', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse(
        JSON.stringify({
          translations: ['only one'],
          detected_source_language: 'en'
        })
      ),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const provider = createOpenAIProvider(config)
    await expect(provider.translate(['a', 'b'], 'es')).rejects.toThrow(
      /unexpected shape/
    )
  })

  it('throws when the model response is not valid JSON', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: chatResponse('not json'),
      bodyTruncated: false,
      headers: {},
      url: config.endpoint
    })

    const provider = createOpenAIProvider(config)
    await expect(provider.translate(['a'], 'es')).rejects.toThrow(
      /not valid JSON/
    )
  })
})
