import { BaseNote } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import {
  persistInboundQuoteEdge,
  resolveInboundQuotedStatus
} from '@/lib/services/quotes/persistInboundQuoteEdge'
import { Status } from '@/lib/types/domain/status'

const QUOTED_STATUS_ID = 'https://remote.test/users/alice/statuses/1'
const STAMP_URI = 'https://remote.test/users/alice/quote_authorizations/abc'

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue({ id: 'signer' })
}))

const mockVerifyRemoteQuote = vi.fn().mockResolvedValue('accepted')
vi.mock('@/lib/services/quotes/verifyRemoteQuote', () => ({
  verifyRemoteQuote: (...params: unknown[]) => mockVerifyRemoteQuote(...params)
}))

const mockGetNote = vi.fn()
vi.mock('@/lib/activities', () => ({
  getNote: (...params: unknown[]) => mockGetNote(...params)
}))

const note = (quoteAuthorization?: string) =>
  ({
    id: 'https://remote.test/users/bob/statuses/9',
    type: 'Note',
    attributedTo: 'https://remote.test/users/bob',
    quote: QUOTED_STATUS_ID,
    ...(quoteAuthorization ? { quoteAuthorization } : null)
  }) as unknown as BaseNote

describe('resolveInboundQuotedStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the stored quoted status without fetching', async () => {
    const stored = { id: QUOTED_STATUS_ID } as unknown as Status
    const database = {
      getStatus: vi.fn().mockResolvedValue(stored)
    } as unknown as Database

    await expect(
      resolveInboundQuotedStatus({
        database,
        note: note(STAMP_URI),
        quotedStatusId: QUOTED_STATUS_ID,
        storeNote: vi.fn()
      })
    ).resolves.toBe(stored)
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('does not fetch a quoted note when the quote carries no stamp to verify', async () => {
    const database = {
      getStatus: vi.fn().mockResolvedValue(null)
    } as unknown as Database

    await expect(
      resolveInboundQuotedStatus({
        database,
        note: note(),
        quotedStatusId: QUOTED_STATUS_ID,
        storeNote: vi.fn()
      })
    ).resolves.toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('refuses a fetched note whose id does not match the one requested', async () => {
    // A redirect or alias answering with a different document would otherwise be
    // stored under the id and AUTHOR it claims, letting a quoter fabricate a
    // status attributed to someone who never wrote it — and `createNoteJob`
    // receives it with no verified sender, so nothing downstream re-checks.
    mockGetNote.mockResolvedValue({
      id: 'https://mastodon.example/users/victim/statuses/999',
      type: 'Note',
      attributedTo: 'https://mastodon.example/users/victim'
    })
    const storeNote = vi.fn()
    const database = {
      getStatus: vi.fn().mockResolvedValue(null)
    } as unknown as Database

    await expect(
      resolveInboundQuotedStatus({
        database,
        note: note(STAMP_URI),
        quotedStatusId: QUOTED_STATUS_ID,
        storeNote
      })
    ).resolves.toBeNull()
    expect(storeNote).not.toHaveBeenCalled()
  })

  it('hands the store callback the single-hop bound', async () => {
    const fetched = { id: QUOTED_STATUS_ID } as unknown as BaseNote
    mockGetNote.mockResolvedValue(fetched)
    const storeNote = vi.fn().mockResolvedValue(undefined)
    const database = {
      getStatus: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: QUOTED_STATUS_ID })
    } as unknown as Database

    await resolveInboundQuotedStatus({
      database,
      note: note(STAMP_URI),
      quotedStatusId: QUOTED_STATUS_ID,
      storeNote
    })

    // The bound comes from here, not from each call site remembering it: it is
    // what stops the stored note chasing its own quote target.
    expect(storeNote).toHaveBeenCalledWith(fetched, {
      skipQuoteResolution: true
    })
  })

  it('degrades to null when the lookup confirming the stored note rejects', async () => {
    // The subtle one: a bare `return <promise>` inside the `try` settles this
    // function AFTER the catch frame is gone, so the rejection escapes and
    // throws out of the inbound job — orphaning a note already committed but
    // never added to a timeline. Only `return await` degrades.
    mockGetNote.mockResolvedValue({ id: QUOTED_STATUS_ID })
    const database = {
      getStatus: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('confirming lookup failed'))
    } as unknown as Database

    await expect(
      resolveInboundQuotedStatus({
        database,
        note: note(STAMP_URI),
        quotedStatusId: QUOTED_STATUS_ID,
        storeNote: vi.fn().mockResolvedValue(undefined)
      })
    ).resolves.toBeNull()
  })
})

describe('persistInboundQuoteEdge authority checks', () => {
  const makeDb = (createStatusQuote = vi.fn().mockResolvedValue({})) =>
    ({
      getStatusQuote: vi.fn().mockResolvedValue(null),
      createStatusQuote
    }) as unknown as Database

  it.each([
    {
      description: 'cross-host stamp',
      stamp: 'https://evil.example/stamp/1'
    },
    { description: 'malformed stamp', stamp: 'not-a-url' },
    { description: 'hostless stamp', stamp: 'urn:uuid:stamp-1' },
    {
      description: 'port mismatch',
      stamp: 'https://remote.test:8080/users/alice/quote_authorizations/abc'
    }
  ])(
    'does not persist authorizationUri with invalid or mismatched origin ($description)',
    async ({ stamp }) => {
      const createSpy = vi.fn().mockResolvedValue({})
      const database = makeDb(createSpy)

      await persistInboundQuoteEdge({
        database,
        note: note(stamp),
        actorId: 'https://remote.test/users/bob',
        quotedStatus: null,
        quotedStatusId: QUOTED_STATUS_ID
      })

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationUri: null
        })
      )
    }
  )

  it('persists authorizationUri when stamp origin matches quotedStatusId', async () => {
    const createSpy = vi.fn().mockResolvedValue({})
    const database = makeDb(createSpy)

    await persistInboundQuoteEdge({
      database,
      note: note(STAMP_URI),
      actorId: 'https://remote.test/users/bob',
      quotedStatus: null,
      quotedStatusId: QUOTED_STATUS_ID
    })

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUri: STAMP_URI
      })
    )
  })

  it('persists authorizationUri when stamp and quotedStatusId share an explicit port', async () => {
    const quotedStatusIdWithPort =
      'https://remote.test:8080/users/alice/statuses/1'
    const stampWithPort =
      'https://remote.test:8080/users/alice/quote_authorizations/abc'
    const createSpy = vi.fn().mockResolvedValue({})
    const database = makeDb(createSpy)

    await persistInboundQuoteEdge({
      database,
      note: {
        id: 'https://remote.test:8080/users/bob/statuses/9',
        type: 'Note',
        attributedTo: 'https://remote.test:8080/users/bob',
        quote: quotedStatusIdWithPort,
        quoteAuthorization: stampWithPort
      } as unknown as BaseNote,
      actorId: 'https://remote.test:8080/users/bob',
      quotedStatus: null,
      quotedStatusId: quotedStatusIdWithPort
    })

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUri: stampWithPort
      })
    )
  })
})
