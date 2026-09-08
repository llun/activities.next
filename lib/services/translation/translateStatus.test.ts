import { createHash } from 'node:crypto'

import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/mastodon/status'

import { translateStatus } from './translateStatus'
import {
  TranslationProvider,
  TranslationProviderError,
  UnsupportedTargetLanguageError
} from './types'

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

interface CacheRow {
  content: string
  detectedSourceLanguage: string | null
}

const createFakeDatabase = (seed: Record<string, CacheRow> = {}) => {
  const store = new Map<string, CacheRow>(Object.entries(seed))
  const key = (
    provider: string,
    source: string,
    target: string,
    hash: string
  ) => `${provider}:${source}:${target}:${hash}`
  const saved: string[] = []
  const database = {
    async getTranslationCache({
      provider,
      sourceLanguage,
      targetLanguage,
      sourceHash
    }) {
      return (
        store.get(key(provider, sourceLanguage, targetLanguage, sourceHash)) ??
        null
      )
    },
    async saveTranslationCache({
      provider,
      sourceLanguage,
      targetLanguage,
      sourceHash,
      content,
      detectedSourceLanguage
    }) {
      saved.push(content)
      store.set(key(provider, sourceLanguage, targetLanguage, sourceHash), {
        content,
        detectedSourceLanguage
      })
    }
  } as unknown as Database
  return { database, saved, store }
}

// Translates by upper-casing, so assertions can tell source from translation.
const createFakeProvider = (
  overrides: Partial<TranslationProvider> = {}
): { provider: TranslationProvider; calls: string[][] } => {
  const calls: string[][] = []
  const provider: TranslationProvider = {
    providerName: 'Fake',
    cacheKey: 'fake',
    async languages() {
      return { source: ['en'], target: ['fr', 'de', 'es'] }
    },
    async translate(texts) {
      calls.push(texts)
      return {
        texts: texts.map((text) => text.toUpperCase()),
        detectedSourceLanguage: 'en',
        provider: 'Fake'
      }
    },
    ...overrides
  }
  return { provider, calls }
}

const buildStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    content: '<p>Hello</p>',
    spoiler_text: '',
    language: 'en',
    media_attachments: [],
    poll: null,
    ...overrides
  }) as unknown as Status

describe('translateStatus', () => {
  it('translates all fields on a full cache miss and writes them back', async () => {
    const { database, saved } = createFakeDatabase()
    const { provider, calls } = createFakeProvider()
    const status = buildStatus({
      content: '<p>Hello</p>',
      spoiler_text: 'cw',
      media_attachments: [
        { id: '1', description: 'a cat' }
      ] as Status['media_attachments'],
      poll: {
        id: '9',
        options: [{ title: 'yes' }, { title: 'no' }]
      } as Status['poll']
    })

    const translation = await translateStatus({
      database,
      provider,
      status,
      targetLanguage: 'fr'
    })

    // Content is sanitized on the way out, which normalizes tag case.
    expect(translation.content).toBe('<p>HELLO</p>')
    expect(translation.spoiler_text).toBe('CW')
    expect(translation.language).toBe('fr')
    expect(translation.media_attachments).toEqual([
      { id: '1', description: 'A CAT' }
    ])
    expect(translation.poll).toEqual({
      id: '9',
      options: [{ title: 'YES' }, { title: 'NO' }]
    })
    expect(translation.detected_source_language).toBe('en')
    expect(translation.provider).toBe('Fake')
    // Every distinct string written to the cache.
    expect(saved.sort()).toEqual(['<P>HELLO</P>', 'A CAT', 'CW', 'NO', 'YES'])
    // One batched backend call.
    expect(calls).toHaveLength(1)
  })

  it('serves cached strings without calling the backend', async () => {
    const { database } = createFakeDatabase({
      [`fake:en:fr:${sha256('<p>Hello</p>')}`]: {
        content: '<p>Bonjour</p>',
        detectedSourceLanguage: 'en'
      }
    })
    const { provider, calls } = createFakeProvider()

    const translation = await translateStatus({
      database,
      provider,
      status: buildStatus({ content: '<p>Hello</p>' }),
      targetLanguage: 'fr'
    })

    expect(translation.content).toBe('<p>Bonjour</p>')
    expect(calls).toHaveLength(0)
  })

  it('only sends cache misses to the backend', async () => {
    const { database } = createFakeDatabase({
      [`fake:en:fr:${sha256('<p>Hello</p>')}`]: {
        content: '<p>Bonjour</p>',
        detectedSourceLanguage: 'en'
      }
    })
    const { provider, calls } = createFakeProvider()

    await translateStatus({
      database,
      provider,
      status: buildStatus({
        content: '<p>Hello</p>',
        spoiler_text: 'fresh'
      }),
      targetLanguage: 'fr'
    })

    expect(calls).toEqual([['fresh']])
  })

  it('deduplicates identical strings into a single translation request', async () => {
    const { database } = createFakeDatabase()
    const { provider, calls } = createFakeProvider()

    await translateStatus({
      database,
      provider,
      status: buildStatus({
        content: 'repeat',
        poll: { id: '1', options: [{ title: 'repeat' }] } as Status['poll']
      }),
      targetLanguage: 'fr'
    })

    expect(calls).toEqual([['repeat']])
  })

  it('sanitizes unsafe markup in the translated content', async () => {
    const { database } = createFakeDatabase()
    const { provider } = createFakeProvider({
      async translate() {
        return {
          texts: ['<a href="javascript:alert(1)">x</a><script>bad()</script>'],
          detectedSourceLanguage: 'en',
          provider: 'Fake'
        }
      }
    })

    const translation = await translateStatus({
      database,
      provider,
      status: buildStatus({ content: '<p>Hello</p>' }),
      targetLanguage: 'fr'
    })

    expect(translation.content).not.toContain('javascript:')
    expect(translation.content).not.toContain('<script')
  })

  it('keys the cache by source language so identical text in different languages does not collide', async () => {
    const { database } = createFakeDatabase({
      [`fake:en:fr:${sha256('gift')}`]: {
        content: 'cadeau',
        detectedSourceLanguage: 'en'
      }
    })
    const { provider, calls } = createFakeProvider()

    // A German status with the same text must NOT reuse the English cache entry.
    const translation = await translateStatus({
      database,
      provider,
      status: buildStatus({ content: 'gift', language: 'de' }),
      targetLanguage: 'fr'
    })

    expect(calls).toEqual([['gift']])
    expect(translation.content).toBe('GIFT')
  })

  it('rejects an unsupported target language with UnsupportedTargetLanguageError', async () => {
    const { database } = createFakeDatabase()
    const { provider } = createFakeProvider()

    await expect(
      translateStatus({
        database,
        provider,
        status: buildStatus(),
        targetLanguage: 'jp'
      })
    ).rejects.toBeInstanceOf(UnsupportedTargetLanguageError)
  })

  it('treats a cache read failure as a miss and still translates', async () => {
    const database = {
      async getTranslationCache() {
        throw new Error('db read down')
      },
      async saveTranslationCache() {}
    } as unknown as Database
    const { provider, calls } = createFakeProvider()

    const translation = await translateStatus({
      database,
      provider,
      status: buildStatus({ content: 'hello' }),
      targetLanguage: 'fr'
    })

    expect(calls).toEqual([['hello']])
    expect(translation.content).toBe('HELLO')
  })

  it('still resolves when the cache write fails', async () => {
    const database = {
      async getTranslationCache() {
        return null
      },
      async saveTranslationCache() {
        throw new Error('db write down')
      }
    } as unknown as Database
    const { provider } = createFakeProvider()

    await expect(
      translateStatus({
        database,
        provider,
        status: buildStatus({ content: 'hello' }),
        targetLanguage: 'fr'
      })
    ).resolves.toMatchObject({ content: 'HELLO' })
  })

  it('propagates backend failures', async () => {
    const { database } = createFakeDatabase()
    const { provider } = createFakeProvider({
      async translate() {
        throw new TranslationProviderError('boom')
      }
    })

    await expect(
      translateStatus({
        database,
        provider,
        status: buildStatus(),
        targetLanguage: 'fr'
      })
    ).rejects.toBeInstanceOf(TranslationProviderError)
  })
})
