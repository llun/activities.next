import { compactActivityPub } from '@/lib/activities/jsonld'
import { BaseNoteSchema } from '@/lib/activities/note'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import {
  type Status,
  fromNote,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

const ACTOR_ID = 'https://llun.test/users/me'
const STATUS_ID = `${ACTOR_ID}/statuses/1`
const QUOTED_ID = 'https://remote.example/users/alice/statuses/7'

const baseStatus = (overrides: Record<string, unknown> = {}): Status =>
  ({
    id: STATUS_ID,
    type: 'Note',
    actorId: ACTOR_ID,
    url: 'https://llun.test/@me/1',
    text: 'hello',
    summary: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply: '',
    attachments: [],
    tags: [],
    replies: [],
    edits: [],
    totalLikes: 0,
    totalShares: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }) as unknown as Status

describe.each([
  ['delivery', getNoteFromStatus],
  ['fetch', toActivityPubObject]
] as const)('%s Note language maps', (_surface, serialize) => {
  it('keys the final content and summary by the declared language', () => {
    const note = serialize(
      baseStatus({
        language: 'th',
        detectedLanguage: 'en',
        summary: 'คำเตือน',
        text: '<p>สวัสดี</p>'
      })
    )!

    expect(note.contentMap).toEqual({ th: note.content })
    expect(note.summaryMap).toEqual({ th: 'คำเตือน' })
  })

  it.each([undefined, null, '', ' ', '12', 'a', 'not a language'])(
    'omits both maps for an absent or invalid declared language %j',
    (language) => {
      const note = serialize(
        baseStatus({
          language,
          detectedLanguage: 'th',
          summary: 'Warning'
        })
      )!
      expect(note).not.toHaveProperty('contentMap')
      expect(note).not.toHaveProperty('summaryMap')
    }
  )

  it.each(['th', 'fil', 'pt-BR', 'zh_TW', 'zh_Hant_TW', ' en '])(
    'uses the same language-code validation as status creation for %j',
    (language) => {
      const note = serialize(baseStatus({ language }))!
      expect(note.contentMap).toEqual({
        [Intl.getCanonicalLocales(language.trim().replaceAll('_', '-'))[0]]:
          note.content
      })
    }
  )

  it.each(['en-abcdefghi', 'zh_'])(
    'omits the maps for %j, which is not a BCP 47 tag',
    (language) => {
      const note = serialize(baseStatus({ language, summary: 'CW' }))!
      expect(note).not.toHaveProperty('contentMap')
      expect(note).not.toHaveProperty('summaryMap')
    }
  )

  it.each([undefined, null, ''])(
    'omits the map for an empty summary %j',
    (summary) => {
      const note = serialize(baseStatus({ language: 'th', summary }))!
      expect(note.contentMap).toEqual({ th: note.content })
      expect(note).not.toHaveProperty('summaryMap')
    }
  )

  it('includes the quote fallback in the mapped content', () => {
    const note = serialize(
      baseStatus({
        language: 'th',
        quote: {
          quotedStatusId: 'https://remote.example/users/test/statuses/7',
          state: 'accepted'
        }
      })
    )!
    expect(note.content).toContain('quote-inline')
    expect(note.contentMap).toEqual({ th: note.content })
  })

  it('preserves maps through JSON-LD compaction, schema parsing and inbound conversion', async () => {
    const note = serialize(
      baseStatus({
        language: 'th',
        text: '<p>สวัสดี</p>',
        summary: 'คำเตือน'
      })
    )!
    const parsed = BaseNoteSchema.parse(
      await compactActivityPub({
        '@context': NOTE_ACTIVITY_CONTEXT,
        ...note
      })
    )

    expect(parsed.contentMap).toEqual({ th: note.content })
    expect(parsed.summaryMap).toEqual({ th: note.summary })
    expect(fromNote(parsed)).toMatchObject({
      language: 'th',
      text: note.content,
      summary: note.summary
    })
  })
})

describe('getNoteFromStatus quote emission', () => {
  it('emits the quote target under all compat aliases plus the stamp for an accepted quote', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: {
          quotedStatusId: QUOTED_ID,
          state: 'accepted',
          authorizationUri: 'https://remote.example/stamp/1'
        }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBe(QUOTED_ID)
    expect(note.quoteUrl).toBe(QUOTED_ID)
    expect(note.quoteUri).toBe(QUOTED_ID)
    expect(note._misskey_quote).toBe(QUOTED_ID)
    expect(note.quoteAuthorization).toBe('https://remote.example/stamp/1')
  })

  it('emits a pending quote target without a stamp', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: { quotedStatusId: QUOTED_ID, state: 'pending' }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBe(QUOTED_ID)
    expect(note.quoteAuthorization).toBeUndefined()
  })

  it('prepends the quote-inline RE: fallback to a quoting note content', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: { quotedStatusId: QUOTED_ID, state: 'pending' }
      })
    ) as Record<string, unknown>

    expect(note.content).toMatch(
      new RegExp(
        `^<p class="quote-inline">RE: <a href="${QUOTED_ID.replaceAll('/', '\\/')}">`
      )
    )
    expect(note.content).toContain('hello')
  })

  it('prepends the quote-inline fallback with quotedStatusUrl when present', () => {
    const quotedUrl = 'https://remote.example/@alice/7'
    const note = getNoteFromStatus(
      baseStatus({
        quote: {
          quotedStatusId: QUOTED_ID,
          quotedStatusUrl: quotedUrl,
          state: 'pending'
        }
      })
    ) as Record<string, unknown>

    expect(note.content).toMatch(
      new RegExp(
        `^<p class="quote-inline">RE: <a href="${quotedUrl.replaceAll('/', '\\/')}">`
      )
    )
  })

  it('does not prepend the fallback when the text already links the quoted status', () => {
    const note = getNoteFromStatus(
      baseStatus({
        text: `have a look at ${QUOTED_ID}`,
        quote: { quotedStatusId: QUOTED_ID, state: 'accepted' }
      })
    ) as Record<string, unknown>

    expect(note.content).not.toContain('quote-inline')
  })

  it('does not touch a non-quote note content', () => {
    const note = getNoteFromStatus(baseStatus()) as Record<string, unknown>

    expect(note.content).not.toContain('quote-inline')
  })

  it('does not emit a quote target for a terminal (revoked) edge', () => {
    const note = getNoteFromStatus(
      baseStatus({
        quote: { quotedStatusId: QUOTED_ID, state: 'revoked' }
      })
    ) as Record<string, unknown>

    expect(note.quote).toBeUndefined()
  })

  it.each([
    { policy: undefined, expected: [ACTIVITY_STREAM_PUBLIC] },
    { policy: 'public', expected: [ACTIVITY_STREAM_PUBLIC] },
    { policy: 'followers', expected: [`${ACTOR_ID}/followers`] },
    { policy: 'nobody', expected: [ACTOR_ID] }
  ])(
    'advertises interactionPolicy.canQuote.automaticApproval for policy $policy',
    ({ policy, expected }) => {
      const note = getNoteFromStatus(
        baseStatus(policy ? { quoteApprovalPolicy: policy } : {})
      ) as Record<string, unknown>

      const interactionPolicy = note.interactionPolicy as {
        canQuote: { automaticApproval: string[]; manualApproval: string[] }
      }
      expect(interactionPolicy.canQuote.automaticApproval).toEqual(expected)
      expect(interactionPolicy.canQuote.manualApproval).toEqual([])
    }
  )
})

describe('getNoteFromStatus sensitive flag', () => {
  it.each([
    { sensitive: true, expected: true },
    { sensitive: false, expected: false },
    { sensitive: undefined, expected: false }
  ])(
    'emits sensitive $expected for a status marked $sensitive',
    ({ sensitive, expected }) => {
      const note = getNoteFromStatus(baseStatus({ sensitive })) as Record<
        string,
        unknown
      >
      expect(note.sensitive).toBe(expected)
    }
  )
})

describe('getNoteFromStatus attachments', () => {
  const attachment = (id: string, mediaType: string, url: string) => ({
    id,
    actorId: ACTOR_ID,
    statusId: STATUS_ID,
    type: 'Document',
    mediaType,
    url,
    width: 100,
    height: 80,
    name: id,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  })
  const photoUrls = Array.from(
    { length: 10 },
    (_, index) => `https://llun.test/api/v1/files/medias/photo-${index}.webp`
  )
  const photos = photoUrls.map((url, index) =>
    attachment(`photo-${index}`, 'image/webp', url)
  )
  const fitness = attachment(
    'fitness',
    'application/vnd.ant.fit',
    '/api/v1/fitness-files/fitness-file-id'
  )
  const attachmentUrls = (note: unknown) =>
    ((note as { attachment: { url: string }[] }).attachment ?? []).map(
      (item) => item.url
    )

  // Pixelfed sends and shows every attachment; Mastodon keeps the first 4 of a
  // remote post itself, so cutting before sending only loses photos.
  it('carries every non-fitness attachment in stored order when the status stores more than 4', () => {
    const note = getNoteFromStatus(
      baseStatus({
        attachments: [...photos.slice(0, 4), fitness, ...photos.slice(4)]
      })
    )
    expect(attachmentUrls(note)).toEqual(photoUrls)
  })

  it('carries every attachment on the Update of an edited post', () => {
    const note = getNoteFromStatus(
      baseStatus({
        attachments: [fitness, ...photos],
        updatedAt: 1700000060000
      }),
      { includeUpdated: true }
    )
    expect(attachmentUrls(note)).toEqual(photoUrls)
    expect((note as Record<string, unknown>).updated).toBeDefined()
  })
})
