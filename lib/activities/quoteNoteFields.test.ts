import { compactActivityPub } from '@/lib/activities/jsonld'
import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import {
  addQuoteFallbackToContent,
  getInteractionPolicyFields,
  getQuoteNoteFields
} from '@/lib/activities/quoteNoteFields'
import { StatusQuote } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/activitystream'

const QUOTED_STATUS_ID = 'https://remote.test/users/alice/statuses/1'
const STAMP_URI = 'https://remote.test/users/alice/quote_authorizations/abc'

const edge = (quote: Partial<StatusQuote> = {}): StatusQuote => ({
  quotedStatusId: QUOTED_STATUS_ID,
  state: 'accepted',
  ...quote
})

describe('getQuoteNoteFields', () => {
  it.each([{ state: 'pending' as const }, { state: 'accepted' as const }])(
    'writes the quote target under every compat alias on a $state edge',
    ({ state }) => {
      expect(getQuoteNoteFields(edge({ state }))).toMatchObject({
        quote: QUOTED_STATUS_ID,
        quoteUrl: QUOTED_STATUS_ID,
        quoteUri: QUOTED_STATUS_ID,
        _misskey_quote: QUOTED_STATUS_ID
      })
    }
  )

  it.each([
    { state: 'rejected' as const },
    { state: 'revoked' as const },
    { state: 'deleted' as const }
  ])('emits nothing for a $state edge', ({ state }) => {
    expect(getQuoteNoteFields(edge({ state }))).toBeNull()
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined }
  ])('emits nothing when the edge is $label', ({ value }) => {
    expect(getQuoteNoteFields(value)).toBeNull()
  })

  it('carries the hosted stamp only on an accepted edge', () => {
    expect(
      getQuoteNoteFields(
        edge({ state: 'accepted', authorizationUri: STAMP_URI })
      )
    ).toHaveProperty('quoteAuthorization', STAMP_URI)
    // An unverified stamp on a pending edge would advertise approval the quoted
    // author never gave.
    expect(
      getQuoteNoteFields(
        edge({ state: 'pending', authorizationUri: STAMP_URI })
      )
    ).not.toHaveProperty('quoteAuthorization')
  })

  it('omits the stamp when an accepted edge has none stored', () => {
    expect(getQuoteNoteFields(edge({ state: 'accepted' }))).not.toHaveProperty(
      'quoteAuthorization'
    )
  })
})

describe('addQuoteFallbackToContent', () => {
  const FALLBACK = `<p class="quote-inline">RE: <a href="${QUOTED_STATUS_ID}">${QUOTED_STATUS_ID}</a></p>`

  it.each([{ state: 'pending' as const }, { state: 'accepted' as const }])(
    'prepends the fallback paragraph on a $state edge',
    ({ state }) => {
      expect(addQuoteFallbackToContent('<p>hi</p>', edge({ state }))).toEqual(
        `${FALLBACK}<p>hi</p>`
      )
    }
  )

  it.each([
    { state: 'rejected' as const },
    { state: 'revoked' as const },
    { state: 'deleted' as const }
  ])('leaves content alone on a $state edge', ({ state }) => {
    expect(addQuoteFallbackToContent('<p>hi</p>', edge({ state }))).toEqual(
      '<p>hi</p>'
    )
  })

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined }
  ])('leaves content alone when the edge is $label', ({ value }) => {
    expect(addQuoteFallbackToContent('<p>hi</p>', value)).toEqual('<p>hi</p>')
  })

  it('skips when the content already contains the quoted url', () => {
    const linked = `<p>see <a href="${QUOTED_STATUS_ID}">this</a></p>`
    expect(addQuoteFallbackToContent(linked, edge())).toEqual(linked)
  })

  it('escapes the url when interpolating', () => {
    const hostile = edge({
      quotedStatusId: 'https://remote.test/statuses/9?a=1&b="<x>'
    })
    expect(addQuoteFallbackToContent('<p>hi</p>', hostile)).toEqual(
      '<p class="quote-inline">RE: <a href="https://remote.test/statuses/9?a=1&amp;b=&quot;&lt;x&gt;">https://remote.test/statuses/9?a=1&amp;b=&quot;&lt;x&gt;</a></p><p>hi</p>'
    )
  })

  it('produces only the fallback for empty content', () => {
    expect(addQuoteFallbackToContent('', edge({ state: 'pending' }))).toEqual(
      FALLBACK
    )
  })
})

// Every surface that emits these fields — sendNote/sendUpdateNote and the AP
// GET/outbox/replies routes — must declare QUOTE_ACTIVITY_CONTEXT. JSON-LD is
// context-driven, so a term the document never defines expands to a blank node
// and is stripped: the note keeps its content and silently loses its quote.
describe('quote fields under JSON-LD compaction', () => {
  const noteWith = (context: unknown) => ({
    '@context': context,
    id: 'https://llun.test/users/me/statuses/1',
    type: 'Note',
    attributedTo: 'https://llun.test/users/me',
    published: '2026-01-01T00:00:00Z',
    content: 'quoting',
    ...getQuoteNoteFields(
      edge({ state: 'accepted', authorizationUri: STAMP_URI })
    ),
    // Rides on EVERY note, quoting or not, which is why the context swap is
    // unconditional — so the terms behind it need guarding just as much as the
    // quote aliases do.
    ...getInteractionPolicyFields({
      actorId: 'https://llun.test/users/me',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  })

  it('survives a receiver that compacts when the note declares QUOTE_ACTIVITY_CONTEXT', async () => {
    const result = (await compactActivityPub(
      noteWith(QUOTE_ACTIVITY_CONTEXT)
    )) as Record<string, unknown>

    expect(result.quote).toBe(QUOTED_STATUS_ID)
    expect(result.quoteUrl).toBe(QUOTED_STATUS_ID)
    expect(result.quoteUri).toBe(QUOTED_STATUS_ID)
    expect(result._misskey_quote).toBe(QUOTED_STATUS_ID)
    expect(result.quoteAuthorization).toBe(STAMP_URI)
    expect(result.interactionPolicy).toEqual({
      canQuote: {
        automaticApproval: ['as:Public'],
        manualApproval: []
      }
    })
  })

  it('is dropped when the note declares only the ActivityStreams context', async () => {
    // The regression this guards: a quoting note delivered under the bare AS2
    // context reaches the receiver as a plain note, so the quote never renders
    // and an approval stamp riding on it is never seen.
    const result = (await compactActivityPub(
      noteWith(ACTIVITY_STREAM_URL)
    )) as Record<string, unknown>

    expect(result.content).toBe('quoting')
    expect(result.quote).toBeUndefined()
    expect(result.quoteUrl).toBeUndefined()
    expect(result.quoteUri).toBeUndefined()
    expect(result._misskey_quote).toBeUndefined()
    expect(result.quoteAuthorization).toBeUndefined()
    expect(result.interactionPolicy).toBeUndefined()
  })
})
