import { handleQuoteResponse } from '@/lib/actions/handleQuoteResponse'
import type { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

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
    updateSpy: ReturnType<typeof vi.fn>
  }> = {}
): Database =>
  ({
    getStatusQuoteByQuoteRequestId: vi
      .fn()
      .mockResolvedValue(
        overrides.edge === undefined
          ? { statusId: QUOTING_STATUS_ID, quotedStatusId: QUOTED_STATUS_ID }
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
  beforeEach(() => vi.clearAllMocks())

  it('accepts a matching outbound quote from the quoted authority, storing the stamp and re-federating', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
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

  it('does not store a stamp hosted on a foreign authority', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    await handleQuoteResponse({
      database,
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

  it('returns false when no outbound quote matches (falls through to follow handling)', async () => {
    const updateSpy = vi.fn()
    const database = makeDatabase({ edge: null, updateSpy })
    const handled = await handleQuoteResponse({
      database,
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
        activity: {
          type: 'Follow',
          actor: QUOTED_AUTHOR,
          object: QUOTE_REQUEST_ID
        }
      })
    ).resolves.toBe(false)
  })
})
