import { getTranslationConfig } from './translation'

describe('getTranslationConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_TRANSLATION_TYPE
    delete process.env.ACTIVITIES_TRANSLATION_API_KEY
    delete process.env.ACTIVITIES_TRANSLATION_ENDPOINT
    delete process.env.ACTIVITIES_TRANSLATION_MODEL
    delete process.env.ACTIVITIES_TRANSLATION_PLAN
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null when no translation env vars are set', () => {
    expect(getTranslationConfig()).toBeNull()
  })

  it('returns null when type is set but unknown', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'unknown'
    expect(getTranslationConfig()).toBeNull()
  })

  it('builds DeepL config defaulting to the free plan', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'deepl'
    process.env.ACTIVITIES_TRANSLATION_API_KEY = 'deepl-key'

    const config = getTranslationConfig()

    expect(config?.translation).toEqual({
      type: 'deepl',
      apiKey: 'deepl-key',
      plan: 'free'
    })
  })

  it('honours the DeepL pro plan', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'deepl'
    process.env.ACTIVITIES_TRANSLATION_API_KEY = 'deepl-key'
    process.env.ACTIVITIES_TRANSLATION_PLAN = 'pro'

    expect(getTranslationConfig()?.translation).toMatchObject({ plan: 'pro' })
  })

  it('returns null when DeepL api key is missing', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'deepl'
    expect(getTranslationConfig()).toBeNull()
  })

  it('builds LibreTranslate config with an optional api key', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'libretranslate'
    process.env.ACTIVITIES_TRANSLATION_ENDPOINT = 'http://libretranslate:5000'

    expect(getTranslationConfig()?.translation).toEqual({
      type: 'libretranslate',
      endpoint: 'http://libretranslate:5000'
    })

    process.env.ACTIVITIES_TRANSLATION_API_KEY = 'libre-key'
    expect(getTranslationConfig()?.translation).toEqual({
      type: 'libretranslate',
      endpoint: 'http://libretranslate:5000',
      apiKey: 'libre-key'
    })
  })

  it('returns null when LibreTranslate endpoint is missing', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'libretranslate'
    expect(getTranslationConfig()).toBeNull()
  })

  it('builds OpenAI config from endpoint, key and model', () => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'openai'
    process.env.ACTIVITIES_TRANSLATION_ENDPOINT =
      'https://api.openai.com/v1/chat/completions'
    process.env.ACTIVITIES_TRANSLATION_API_KEY = 'sk-test'
    process.env.ACTIVITIES_TRANSLATION_MODEL = 'gpt-4o-mini'

    expect(getTranslationConfig()?.translation).toEqual({
      type: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
  })

  it.each([
    ['endpoint', 'ACTIVITIES_TRANSLATION_ENDPOINT'],
    ['api key', 'ACTIVITIES_TRANSLATION_API_KEY'],
    ['model', 'ACTIVITIES_TRANSLATION_MODEL']
  ])('returns null when OpenAI %s is missing', (_label, missingKey) => {
    process.env.ACTIVITIES_TRANSLATION_TYPE = 'openai'
    process.env.ACTIVITIES_TRANSLATION_ENDPOINT =
      'https://api.openai.com/v1/chat/completions'
    process.env.ACTIVITIES_TRANSLATION_API_KEY = 'sk-test'
    process.env.ACTIVITIES_TRANSLATION_MODEL = 'gpt-4o-mini'
    delete process.env[missingKey]

    expect(getTranslationConfig()).toBeNull()
  })
})
