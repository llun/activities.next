import {
  ACTIVITY_STREAMS_CONTEXT_URL,
  SECURITY_V1_CONTEXT_URL,
  compactActivityPub,
  normalizeInputContext,
  offlineDocumentLoader
} from '@/lib/activities/jsonld'
import { BaseNote, getContent, getLanguage } from '@/lib/activities/note'

const asRecord = (value: unknown) => value as Record<string, unknown>

describe('compactActivityPub', () => {
  it('canonicalises an array-valued type to a bare term', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': ACTIVITY_STREAMS_CONTEXT_URL,
        id: 'https://remote.example/notes/1',
        type: ['Note'],
        attributedTo: 'https://remote.example/users/alice',
        content: 'hello',
        published: '2026-01-01T00:00:00Z'
      })
    )

    expect(result.type).toBe('Note')
    expect(result.id).toBe('https://remote.example/notes/1')
    expect(result.content).toBe('hello')
    expect(result['@context']).toBeUndefined()
  })

  it('resolves an inline id reference to a string', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': ACTIVITY_STREAMS_CONTEXT_URL,
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: { id: 'https://remote.example/users/alice' },
        published: '2026-01-01T00:00:00Z'
      })
    )

    expect(result.attributedTo).toBe('https://remote.example/users/alice')
  })

  it('forces recipients to arrays and keeps the compact public alias', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': ACTIVITY_STREAMS_CONTEXT_URL,
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z',
        to: 'https://www.w3.org/ns/activitystreams#Public',
        cc: 'https://remote.example/users/alice/followers'
      })
    )

    expect(result.to).toEqual(['as:Public'])
    expect(result.cc).toEqual(['https://remote.example/users/alice/followers'])
  })

  it('keeps an embedded object but collapses a bare reference', async () => {
    const create = asRecord(
      await compactActivityPub({
        '@context': ACTIVITY_STREAMS_CONTEXT_URL,
        id: 'https://remote.example/activities/1',
        type: 'Create',
        actor: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z',
        object: {
          id: 'https://remote.example/notes/1',
          type: 'Note',
          attributedTo: 'https://remote.example/users/alice',
          content: 'embedded',
          published: '2026-01-01T00:00:00Z'
        }
      })
    )
    expect(asRecord(create.object).type).toBe('Note')
    expect(asRecord(create.object).content).toBe('embedded')

    const announce = asRecord(
      await compactActivityPub({
        '@context': ACTIVITY_STREAMS_CONTEXT_URL,
        id: 'https://remote.example/activities/2',
        type: 'Announce',
        actor: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z',
        object: 'https://other.example/notes/9'
      })
    )
    expect(announce.object).toBe('https://other.example/notes/9')
  })

  it('keeps a custom emoji tag with a bare Emoji type', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': [
          ACTIVITY_STREAMS_CONTEXT_URL,
          { toot: 'http://joinmastodon.org/ns#', Emoji: 'toot:Emoji' }
        ],
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z',
        tag: [
          {
            type: 'Emoji',
            name: ':blobcat:',
            updated: '2026-01-01T00:00:00Z',
            icon: {
              type: 'Image',
              mediaType: 'image/png',
              url: 'https://remote.example/emoji/blobcat.png'
            }
          }
        ]
      })
    )

    const tags = result.tag as Array<Record<string, unknown>>
    expect(tags).toHaveLength(1)
    expect(tags[0].type).toBe('Emoji')
    expect(tags[0].name).toBe(':blobcat:')
  })

  it('keeps a hashtag tag with a bare Hashtag type', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': [ACTIVITY_STREAMS_CONTEXT_URL, { Hashtag: 'as:Hashtag' }],
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z',
        tag: [
          {
            type: 'Hashtag',
            href: 'https://remote.example/tags/fediverse',
            name: '#fediverse'
          }
        ]
      })
    )

    const tags = result.tag as Array<Record<string, unknown>>
    expect(tags).toHaveLength(1)
    expect(tags[0].type).toBe('Hashtag')
    expect(tags[0].name).toBe('#fediverse')
  })

  it('injects a default context for documents that omit @context', async () => {
    const result = asRecord(
      await compactActivityPub({
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: 'https://remote.example/users/alice',
        content: 'no context',
        published: '2026-01-01T00:00:00Z'
      })
    )

    expect(result.type).toBe('Note')
    expect(result.content).toBe('no context')
  })

  it('drops terms from unknown contexts without dereferencing them', async () => {
    const result = asRecord(
      await compactActivityPub({
        '@context': [
          ACTIVITY_STREAMS_CONTEXT_URL,
          'https://malicious.example/should-never-be-fetched.jsonld'
        ],
        id: 'https://remote.example/notes/1',
        type: 'Note',
        attributedTo: 'https://remote.example/users/alice',
        published: '2026-01-01T00:00:00Z'
      })
    )

    expect(result.type).toBe('Note')
    expect(result.id).toBe('https://remote.example/notes/1')
  })

  it('keeps scalar actor fields as strings despite a document default language', async () => {
    // Akkoma/Pleroma (litepub) actors set a document-level default language in
    // their inline @context. Left untouched, JSON-LD wraps every scalar string
    // into a language-tagged value object (and maps name/summary into
    // *Map containers), which breaks the strict Actor schema. The compactor
    // must strip the default language so these stay plain strings.
    const result = asRecord(
      await compactActivityPub({
        '@context': [
          ACTIVITY_STREAMS_CONTEXT_URL,
          'https://litepub.example/schemas/litepub-0.1.jsonld',
          { '@language': 'und', htmlMfm: 'https://w3id.org/fep/c16b#htmlMfm' }
        ],
        id: 'https://litepub.example/users/sukino',
        type: 'Person',
        preferredUsername: 'sukino',
        name: 'Sukino VERSE',
        summary: 'a litepub actor',
        inbox: 'https://litepub.example/users/sukino/inbox',
        outbox: 'https://litepub.example/users/sukino/outbox'
      })
    )

    expect(result.preferredUsername).toBe('sukino')
    expect(result.name).toBe('Sukino VERSE')
    expect(result.summary).toBe('a litepub actor')
    expect(result.nameMap).toBeUndefined()
    expect(result.summaryMap).toBeUndefined()
  })

  it('recovers an actor public key defined only via a litepub context', async () => {
    // litepub defines publicKey, but our offline loader cannot resolve the
    // remote litepub context, and these actors do not list security/v1
    // themselves. Ensuring security/v1 is part of the expansion context keeps
    // the publicKey from being dropped.
    const publicKeyPem =
      '-----BEGIN PUBLIC KEY-----\nMIIBexample\n-----END PUBLIC KEY-----\n'
    const result = asRecord(
      await compactActivityPub({
        '@context': [
          ACTIVITY_STREAMS_CONTEXT_URL,
          'https://litepub.example/schemas/litepub-0.1.jsonld',
          { '@language': 'und' }
        ],
        id: 'https://litepub.example/users/sukino',
        type: 'Person',
        preferredUsername: 'sukino',
        inbox: 'https://litepub.example/users/sukino/inbox',
        outbox: 'https://litepub.example/users/sukino/outbox',
        publicKey: {
          id: 'https://litepub.example/users/sukino#main-key',
          owner: 'https://litepub.example/users/sukino',
          publicKeyPem
        }
      })
    )

    expect(result.publicKey).toMatchObject({
      id: 'https://litepub.example/users/sukino#main-key',
      owner: 'https://litepub.example/users/sukino',
      publicKeyPem
    })
  })

  it('returns non-object input unchanged', async () => {
    await expect(
      compactActivityPub('https://remote.example/notes/1')
    ).resolves.toBe('https://remote.example/notes/1')
    await expect(compactActivityPub(null)).resolves.toBeNull()
  })

  it('falls back to the raw input when compaction fails', async () => {
    const malformed = {
      '@context': { '@version': 99 },
      id: 'https://remote.example/notes/1',
      type: 'Note'
    }
    await expect(compactActivityPub(malformed)).resolves.toBe(malformed)
  })
})

describe('offlineDocumentLoader', () => {
  it('serves the bundled ActivityStreams context', async () => {
    const loaded = await offlineDocumentLoader(ACTIVITY_STREAMS_CONTEXT_URL)
    expect(loaded.documentUrl).toBe(ACTIVITY_STREAMS_CONTEXT_URL)
    const document = loaded.document as { '@context': Record<string, unknown> }
    expect(document['@context'].as).toBe(
      'https://www.w3.org/ns/activitystreams#'
    )
  })

  it('serves bundled contexts referenced over http', async () => {
    const loaded = await offlineDocumentLoader('http://w3id.org/security/v1')
    const document = loaded.document as { '@context': Record<string, unknown> }
    expect(document['@context']).toBeDefined()
    expect(document['@context'].publicKey).toBeDefined()
  })

  it('returns an empty context for unknown URLs instead of fetching', async () => {
    const loaded = await offlineDocumentLoader(
      'https://malicious.example/ctx.jsonld'
    )
    expect(loaded.document).toEqual({ '@context': {} })
  })
})

describe('normalizeInputContext', () => {
  const contextOf = (input: Record<string, unknown>) =>
    normalizeInputContext(input)['@context']

  it('applies the default context when @context is absent', () => {
    expect(contextOf({ id: 'https://remote.example/notes/1' })).toEqual([
      ACTIVITY_STREAMS_CONTEXT_URL,
      SECURITY_V1_CONTEXT_URL
    ])
  })

  it('drops an undetermined default language and base direction but keeps inline terms', () => {
    const context = contextOf({
      '@context': [
        ACTIVITY_STREAMS_CONTEXT_URL,
        {
          '@language': 'und',
          '@direction': 'ltr',
          htmlMfm: 'https://x.example#m'
        }
      ]
    }) as unknown[]

    expect(context).toContainEqual({ htmlMfm: 'https://x.example#m' })
    expect(JSON.stringify(context)).not.toContain('@language')
    expect(JSON.stringify(context)).not.toContain('@direction')
  })

  it('preserves a meaningful default language (note language detection relies on it)', () => {
    const context = contextOf({
      '@context': [
        ACTIVITY_STREAMS_CONTEXT_URL,
        { '@language': 'th', '@direction': 'ltr' }
      ]
    }) as unknown[]

    // The real language stays; only the base direction is dropped.
    expect(context).toContainEqual({ '@language': 'th' })
    expect(JSON.stringify(context)).not.toContain('@direction')
  })

  it('adds security/v1 as the lowest-precedence fallback', () => {
    const context = contextOf({
      '@context': [
        ACTIVITY_STREAMS_CONTEXT_URL,
        { foo: 'https://x.example#foo' }
      ]
    }) as unknown[]

    // Prepended, so a sender's own contexts/terms still override it.
    expect(context[0]).toBe(SECURITY_V1_CONTEXT_URL)
    expect(context).toContain(ACTIVITY_STREAMS_CONTEXT_URL)
  })

  it('does not duplicate security/v1 when the sender already lists it', () => {
    const context = contextOf({
      '@context': [ACTIVITY_STREAMS_CONTEXT_URL, SECURITY_V1_CONTEXT_URL]
    }) as unknown[]

    expect(
      context.filter((entry) => entry === SECURITY_V1_CONTEXT_URL)
    ).toHaveLength(1)
  })

  it.each([
    ['http scheme', 'http://w3id.org/security/v1'],
    ['trailing slash', 'https://w3id.org/security/v1/'],
    ['http scheme with trailing slash', 'http://w3id.org/security/v1/']
  ])('does not add a second security/v1 for the %s variant', (_label, url) => {
    const context = contextOf({
      '@context': [ACTIVITY_STREAMS_CONTEXT_URL, url]
    }) as unknown[]

    expect(context).not.toContain(SECURITY_V1_CONTEXT_URL)
    expect(context).toContain(url)
  })

  it('wraps a single string @context into an array with the fallback', () => {
    expect(contextOf({ '@context': ACTIVITY_STREAMS_CONTEXT_URL })).toEqual([
      SECURITY_V1_CONTEXT_URL,
      ACTIVITY_STREAMS_CONTEXT_URL
    ])
  })

  it('passes non-object context entries through untouched', () => {
    const context = contextOf({
      '@context': [ACTIVITY_STREAMS_CONTEXT_URL, null, ['nested']]
    }) as unknown[]

    expect(context).toContain(null)
    expect(context).toContainEqual(['nested'])
  })

  it('does not mutate the caller input or its inline context objects', () => {
    const inlineContext = { '@language': 'und', '@direction': 'ltr' }
    const input = {
      '@context': [ACTIVITY_STREAMS_CONTEXT_URL, inlineContext],
      id: 'https://remote.example/users/a'
    }

    normalizeInputContext(input)

    // The original input and its nested context object are untouched.
    expect(input['@context']).toEqual([
      ACTIVITY_STREAMS_CONTEXT_URL,
      inlineContext
    ])
    expect(inlineContext).toEqual({ '@language': 'und', '@direction': 'ltr' })
  })
})

describe('compactActivityPub note language handling', () => {
  const noteWithContextLanguage = (language: string) => ({
    '@context': [ACTIVITY_STREAMS_CONTEXT_URL, { '@language': language }],
    id: 'https://remote.example/notes/1',
    type: 'Note',
    attributedTo: 'https://remote.example/users/alice',
    content: '<p>hello</p>',
    published: '2026-01-01T00:00:00Z'
  })

  it('keeps content readable and language null for an undetermined default', async () => {
    const note = (await compactActivityPub(
      noteWithContextLanguage('und')
    )) as unknown as BaseNote

    expect(getContent(note)).toBe('<p>hello</p>')
    // "und" carries no real language, so detection stays null (no regression).
    expect(getLanguage(note)).toBeNull()
  })

  it('preserves a meaningful default language for detection', async () => {
    const note = (await compactActivityPub(
      noteWithContextLanguage('th')
    )) as unknown as BaseNote

    expect(getContent(note)).toBe('<p>hello</p>')
    expect(getLanguage(note)).toBe('th')
  })
})
