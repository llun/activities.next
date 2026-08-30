import { getAltTextConfig } from './altText'

describe('getAltTextConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_ALT_TEXT_ENDPOINT
    delete process.env.ACTIVITIES_ALT_TEXT_API_KEY
    delete process.env.ACTIVITIES_ALT_TEXT_MODEL
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null when no alt text env vars are set', () => {
    expect(getAltTextConfig()).toBeNull()
  })

  it('builds AltText config from endpoint, key and model', () => {
    process.env.ACTIVITIES_ALT_TEXT_ENDPOINT =
      'https://api.openai.com/v1/chat/completions'
    process.env.ACTIVITIES_ALT_TEXT_API_KEY = 'sk-test'
    process.env.ACTIVITIES_ALT_TEXT_MODEL = 'gpt-4o-mini'

    expect(getAltTextConfig()?.altText).toEqual({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
  })

  it.each([
    ['endpoint', 'ACTIVITIES_ALT_TEXT_ENDPOINT'],
    ['api key', 'ACTIVITIES_ALT_TEXT_API_KEY'],
    ['model', 'ACTIVITIES_ALT_TEXT_MODEL']
  ])('returns null when %s is missing', (_label, missingKey) => {
    process.env.ACTIVITIES_ALT_TEXT_ENDPOINT =
      'https://api.openai.com/v1/chat/completions'
    process.env.ACTIVITIES_ALT_TEXT_API_KEY = 'sk-test'
    process.env.ACTIVITIES_ALT_TEXT_MODEL = 'gpt-4o-mini'
    delete process.env[missingKey]

    expect(getAltTextConfig()).toBeNull()
  })
})
