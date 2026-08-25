import { handleQuoteResponse } from '@/lib/actions/handleQuoteResponse'
import type { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

const mockVerifyStamp = vi.fn()
vi.mock('@/lib/services/quotes/verifyRemoteQuote', () => ({
  verifyQuoteAuthorizationStamp: (...params: unknown[]) =>
    mockVerifyStamp(...params)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const QUOTE_REQUEST_ID =
  'https://remote.example/users/me/statuses/9#quote-request'
const QUOTING_STATUS_ID = 'https://remote.example/users/me/statuses/9'
const QUOTED_STATUS_ID = 'https://target.example/users/alice/statuses/1'
const QUOTED_AUTHOR = 'https://target.example/users/alice'
const STAMP_URI = 'https://target.example/users/alice/quote_authorizations/abc'

const makeDatabase = (
  overrides: Partial<{
    edge: { statusId: string; quotedStatusId: string } | null
    edgeState: string
    updateSpy: ReturnType<typeof vi.fn>
  }> = {}
): Database =>
  ({
    getStatusQuoteByQuoteRequestId: vi.fn().mockResolvedValue(
      overrides.edge === undefined
        ? {
            statusId: QUOTING_STATUS_ID,
            quotedStatusId: QUOTED_STATUS_ID,
            state: overrides.edgeState ?? 'pending'
          }
        : overrides.edge
    ),
    updateStatusQuoteState:
      overrides.updateSpy ?? vi.fn().mockResolvedValue(null),
    getStatus: vi.fn().mockImplementation(({ statusId }) =>
      Promise.resolve(
        statusId === QUOTED_STATUS_ID
          ? { type: 'Note', id: QUOTED_STATUS_ID, actorId: QUOTED_AUTHOR }
          : {
              id: QUOTING_STATUS_ID,
              actorId: 'https://remote.example/users/me'
            }
      )
    )
  }) as unknown as Database

describe('handleQuoteResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyStamp.mockResolvedValue('verified')
  })

  it('accepts a matching outbound quote from the quoted authority, storing the stamp and re-federating', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(handled).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'accepted',
      authorizationUri: STAMP_URI
    })
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_UPDATE_NOTE_JOB_NAME })
    )
  })

  it('rejects a matching outbound quote from the quoted authority', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Reject',
        actor: QUOTED_AUTHOR,
        object: { id: QUOTE_REQUEST_ID }
      }
    })

    expect(handled).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'rejected'
    })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('ignores a response from a foreign authority (forgery)', async () => {
    const updateSpy = vi.fn()
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: 'https://evil.example/users/mallory',
      activity: {
        type: 'Accept',
        actor: 'https://evil.example/users/mallory',
        object: QUOTE_REQUEST_ID,
        result: 'https://evil.example/stamp/1'
      }
    })

    expect(handled).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("does not store a result that does not verify as this edge's stamp", async () => {
    // `result` is remote-supplied and only same-host checked, so a hostile
    // quoted author could pass off any co-resident id — an actor, a status — as
    // the stamp. `deleteObjectJob` matches stored stamps when deciding whether
    // an inbound Delete is a quote revocation, so an unverified value planted
    // here swallows that object's own legitimate Delete.
    mockVerifyStamp.mockResolvedValue('mismatch')
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })

    await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: `${QUOTED_AUTHOR}/statuses/not-a-stamp`
      }
    })

    // Still accepted — it simply carries no stamp to re-federate.
    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'accepted',
      authorizationUri: undefined
    })
  })

  it('keeps a stamp the check could not read, rather than dropping it forever', async () => {
    // `unavailable` is not a disproof. This edge goes pending -> accepted here
    // and `accepted -> accepted` is a no-op, so no later Accept could ever
    // supply the stamp: dropping it on one transient 503 would strip
    // quoteAuthorization from every federated copy of the note permanently and
    // leave receivers rendering an approved quote as unapproved.
    mockVerifyStamp.mockResolvedValue('unavailable')
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })

    await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'accepted',
      authorizationUri: STAMP_URI
    })
  })

  it('does not re-fetch the stamp for an Accept replayed against a settled edge', async () => {
    // Nothing to settle, and the state machine would discard the write — but a
    // verified quoted author could otherwise replay one Accept indefinitely and
    // make us re-fetch on each, inline in the inbox request.
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy, edgeState: 'accepted' })

    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(handled).toBe(true)
    expect(mockVerifyStamp).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('verifies the stamp against this edge, not merely its host', async () => {
    const database = makeDatabase({})

    await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(mockVerifyStamp).toHaveBeenCalledWith(
      expect.objectContaining({
        stampUri: STAMP_URI,
        quotedAuthorId: QUOTED_AUTHOR,
        quotingStatusId: QUOTING_STATUS_ID,
        quotedStatusId: QUOTED_STATUS_ID
      })
    )
  })

  it('does not store a stamp hosted on a foreign authority', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: 'https://evil.example/stamp/1'
      }
    })

    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'accepted',
      authorizationUri: undefined
    })
  })

  it('rejects when the quoted status author cannot be resolved (fail closed, no host fallback)', async () => {
    // A co-resident of the quoted author must not settle our quote just because
    // they share a host; if we cannot confirm the exact author, deny.
    const updateSpy = vi.fn()
    const database = {
      getStatusQuoteByQuoteRequestId: vi.fn().mockResolvedValue({
        statusId: QUOTING_STATUS_ID,
        quotedStatusId: QUOTED_STATUS_ID
      }),
      updateStatusQuoteState: updateSpy,
      getStatus: vi.fn().mockResolvedValue(null)
    } as unknown as Database
    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: 'https://target.example/users/mallory',
      activity: {
        type: 'Accept',
        actor: 'https://target.example/users/mallory',
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(handled).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'Accept' as const, extra: { result: STAMP_URI } },
    { type: 'Reject' as const, extra: {} }
  ])(
    'refuses a $type whose document claims the quoted author but was signed by someone else',
    async ({ type, extra }) => {
      // The inbox guard verifies `actor` on the RAW body, but what reaches here
      // is the COMPACTED document, and a sender-supplied JSON-LD context can
      // alias `actor` onto a value that was never signed for: a document signed
      // by mallory can compact to `actor: alice`. Authorizing on that field let
      // any federatable actor settle someone else's pending quote, so the
      // comparison must use the signature-verified sender instead.
      const updateSpy = vi.fn().mockResolvedValue(null)
      const database = makeDatabase({ updateSpy })

      const handled = await handleQuoteResponse({
        database,
        verifiedSenderActorId: 'https://evil.example/users/mallory',
        activity: {
          type,
          actor: QUOTED_AUTHOR,
          object: QUOTE_REQUEST_ID,
          ...extra
        }
      })

      expect(handled).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
      expect(getQueue().publish).not.toHaveBeenCalled()
    }
  )

  it('accepts when the verified sender matches the quoted author despite a mismatched document actor', async () => {
    // The mirror of the case above: the signature is what authorizes, so a
    // document whose `actor` compacted to something else does not block a
    // genuine approval from the quoted author.
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })

    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: 'https://somewhere.example/users/someone',
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(handled).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'accepted' })
    )
  })

  it('returns false when no outbound quote matches (falls through to follow handling)', async () => {
    const updateSpy = vi.fn()
    const database = makeDatabase({ edge: null, updateSpy })
    const handled = await handleQuoteResponse({
      database,
      verifiedSenderActorId: QUOTED_AUTHOR,
      activity: {
        type: 'Accept',
        actor: QUOTED_AUTHOR,
        object: QUOTE_REQUEST_ID,
        result: STAMP_URI
      }
    })

    expect(handled).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns false for non-Accept/Reject activities', async () => {
    const database = makeDatabase()
    await expect(
      handleQuoteResponse({
        database,
        verifiedSenderActorId: QUOTED_AUTHOR,
        activity: {
          type: 'Follow',
          actor: QUOTED_AUTHOR,
          object: QUOTE_REQUEST_ID
        }
      })
    ).resolves.toBe(false)
  })
})
