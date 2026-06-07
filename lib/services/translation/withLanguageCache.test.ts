import { withLanguageCache } from './index'
import { TranslationProvider } from './types'

const baseProvider = (
  languages: () => Promise<{ source: string[]; target: string[] }>
): TranslationProvider => ({
  providerName: 'Fake',
  cacheKey: 'fake',
  languages,
  async translate(texts) {
    return {
      texts,
      detectedSourceLanguage: 'en',
      provider: 'Fake'
    }
  }
})

describe('withLanguageCache', () => {
  it('memoizes a successful languages() lookup across calls', async () => {
    const languages = jest
      .fn()
      .mockResolvedValue({ source: ['en'], target: ['fr'] })
    const provider = withLanguageCache(baseProvider(languages))

    await provider.languages()
    await provider.languages()

    expect(languages).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejected lookup, so a transient failure can be retried', async () => {
    const languages = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ source: ['en'], target: ['fr'] })
    const provider = withLanguageCache(baseProvider(languages))

    await expect(provider.languages()).rejects.toThrow('transient')
    // The retry succeeds because the rejected promise was not cached.
    await expect(provider.languages()).resolves.toEqual({
      source: ['en'],
      target: ['fr']
    })
    expect(languages).toHaveBeenCalledTimes(2)
  })
})
