import { createHash } from 'node:crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Status } from '@/lib/types/mastodon/status'

import { translateStatus } from './translateStatus'
import { TranslationProvider } from './types'

const buildStatus = (content: string): Status =>
  ({
    content,
    spoiler_text: '',
    language: 'en',
    media_attachments: [],
    poll: null
  }) as unknown as Status

/**
 * Exercises the real translation_cache table (migration + SQL mixin) against
 * SQLite so the second translation of the same string is served from cache and
 * never reaches the backend.
 */
describe('translation cache (SQLite)', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('persists and reuses translations across calls', async () => {
    let backendCalls = 0
    const provider: TranslationProvider = {
      providerName: 'Fake',
      cacheKey: 'fake',
      async languages() {
        return { source: ['en'], target: ['fr'] }
      },
      async translate(texts) {
        backendCalls += 1
        return {
          texts: texts.map((text) => `fr:${text}`),
          detectedSourceLanguage: 'en',
          provider: 'Fake'
        }
      }
    }

    const first = await translateStatus({
      database,
      provider,
      status: buildStatus('<p>Hello</p>'),
      targetLanguage: 'fr'
    })
    expect(first.content).toBe('fr:<p>Hello</p>')
    expect(backendCalls).toBe(1)

    const second = await translateStatus({
      database,
      provider,
      status: buildStatus('<p>Hello</p>'),
      targetLanguage: 'fr'
    })
    expect(second.content).toBe('fr:<p>Hello</p>')
    // Served from the SQLite cache: the backend was not hit a second time.
    expect(backendCalls).toBe(1)

    const cached = await database.getTranslationCache({
      provider: 'fake',
      targetLanguage: 'fr',
      sourceHash: createHash('sha256').update('<p>Hello</p>').digest('hex')
    })
    expect(cached).toEqual({
      content: 'fr:<p>Hello</p>',
      detectedSourceLanguage: 'en'
    })
  })
})
