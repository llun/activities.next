import type { BaseNote } from '@/lib/activities/note'
import type { Database } from '@/lib/database/types'
import { verifyRemoteQuote } from '@/lib/services/quotes/verifyRemoteQuote'
import type { Status } from '@/lib/types/domain/status'

vi.mock('@/lib/utils/request', () => ({ request: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))
// Compaction is tested separately; keep it identity here so the stamp body we
// return in tests is validated as-is.
vi.mock('@/lib/activities/jsonld', () => ({
  compactActivityPub: vi.fn(async (input: unknown) => input)
}))

const QUOTING_ACTOR_ID = 'https://remote.example/users/quoter'
const QUOTED_AUTHOR_ID = 'https://llun.test/users/target'
const QUOTED_STATUS_ID = 'https://llun.test/users/target/statuses/1'
const QUOTING_NOTE_ID = 'https://remote.example/users/quoter/statuses/9'
const STAMP_URI = 'https://llun.test/users/target/quote_authorizations/1'

const database = {} as Database

const makeNote = (extra: Record<string, unknown> = {}): BaseNote =>
  ({
    id: QUOTING_NOTE_ID,
    type: 'Note',
    attributedTo: QUOTING_ACTOR_ID,
    quote: QUOTED_STATUS_ID,
    ...extra
  }) as unknown as BaseNote

const makeQuotedStatus = (actorId = QUOTED_AUTHOR_ID): Status =>
  ({ type: 'Note', actorId }) as unknown as Status

const validStampBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: STAMP_URI,
    type: 'QuoteAuthorization',
    attributedTo: QUOTED_AUTHOR_ID,
    interactingObject: QUOTING_NOTE_ID,
    interactionTarget: QUOTED_STATUS_ID,
    ...overrides
  })

describe('verifyRemoteQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a self-quote (same author) without fetching a stamp', async () => {
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    const state = await verifyRemoteQuote({
      database,
      note: makeNote(),
      actorId: QUOTED_AUTHOR_ID,
      quotedStatus: makeQuotedStatus(QUOTED_AUTHOR_ID)
    })
    expect(state).toBe('accepted')
    expect(request).not.toHaveBeenCalled()
  })

  it('is pending when there is no authorization stamp', async () => {
    const state = await verifyRemoteQuote({
      database,
      note: makeNote(),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })

  it('is pending when the quoted status is unknown locally', async () => {
    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: STAMP_URI }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: null
    })
    expect(state).toBe('pending')
  })

  it('accepts when the stamp validates all three fields', async () => {
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: validStampBody()
    })

    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: STAMP_URI }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('accepted')
  })

  it('is pending when the stamp fetch does not return 200', async () => {
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 404,
      body: ''
    })

    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: STAMP_URI }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })

  it.each([
    { field: 'attributedTo', value: 'https://evil.example/users/impostor' },
    { field: 'interactingObject', value: 'https://evil.example/notes/other' },
    { field: 'interactionTarget', value: 'https://evil.example/notes/other' }
  ])(
    'is pending when the stamp $field does not match',
    async ({ field, value }) => {
      const { request } = await vi.importMock<
        typeof import('@/lib/utils/request')
      >('@/lib/utils/request')
      ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
        statusCode: 200,
        body: validStampBody({ [field]: value })
      })

      const state = await verifyRemoteQuote({
        database,
        note: makeNote({ quoteAuthorization: STAMP_URI }),
        actorId: QUOTING_ACTOR_ID,
        quotedStatus: makeQuotedStatus()
      })
      expect(state).toBe('pending')
    }
  )

  it('is pending for a Misskey bare quote with no stamp', async () => {
    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quote: undefined, _misskey_quote: QUOTED_STATUS_ID }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })

  it('is pending when the stamp is hosted on a foreign authority (forgery)', async () => {
    // The attacker serves a stamp that names the victim in attributedTo and
    // matches both ids, but hosts it on their own domain. The authority check
    // must reject it.
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    const foreignStampUri = 'https://evil.example/quote_authorizations/1'
    ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: foreignStampUri,
        type: 'QuoteAuthorization',
        attributedTo: QUOTED_AUTHOR_ID,
        interactingObject: QUOTING_NOTE_ID,
        interactionTarget: QUOTED_STATUS_ID
      })
    })

    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: foreignStampUri }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })

  it('is pending when the stamp id is on a foreign authority', async () => {
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: validStampBody({
        id: 'https://evil.example/quote_authorizations/9'
      })
    })

    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: STAMP_URI }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })

  it('is pending when the stamp body is not a valid QuoteAuthorization', async () => {
    const { request } = await vi.importMock<
      typeof import('@/lib/utils/request')
    >('@/lib/utils/request')
    ;(request as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ id: STAMP_URI, type: 'Note' })
    })

    const state = await verifyRemoteQuote({
      database,
      note: makeNote({ quoteAuthorization: STAMP_URI }),
      actorId: QUOTING_ACTOR_ID,
      quotedStatus: makeQuotedStatus()
    })
    expect(state).toBe('pending')
  })
})
