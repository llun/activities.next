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
const STAMP_URI = 'https://llun.test/users/target/quote_authorizations/abc'

const makeDatabase = (
  overrides: Partial<{
    edge: { statusId: string } | null
    updateSpy: ReturnType<typeof vi.fn>
    statusActorId: string
  }> = {}
): Database =>
  ({
    getStatusQuoteByQuoteRequestId: vi
      .fn()
      .mockResolvedValue(
        overrides.edge === undefined
          ? { statusId: QUOTING_STATUS_ID }
          : overrides.edge
      ),
    updateStatusQuoteState:
      overrides.updateSpy ?? vi.fn().mockResolvedValue(null),
    getStatus: vi
      .fn()
      .mockResolvedValue({
        id: QUOTING_STATUS_ID,
        actorId: 'https://remote.example/users/me'
      })
  }) as unknown as Database

describe('handleQuoteResponse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a matching outbound quote, storing the stamp and re-federating', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
      activity: {
        type: 'Accept',
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

  it('rejects a matching outbound quote', async () => {
    const updateSpy = vi.fn().mockResolvedValue(null)
    const database = makeDatabase({ updateSpy })
    const handled = await handleQuoteResponse({
      database,
      activity: { type: 'Reject', object: { id: QUOTE_REQUEST_ID } }
    })

    expect(handled).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith({
      statusId: QUOTING_STATUS_ID,
      state: 'rejected'
    })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('returns false when no outbound quote matches (falls through to follow handling)', async () => {
    const updateSpy = vi.fn()
    const database = makeDatabase({ edge: null, updateSpy })
    const handled = await handleQuoteResponse({
      database,
      activity: { type: 'Accept', object: QUOTE_REQUEST_ID, result: STAMP_URI }
    })

    expect(handled).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns false for non-Accept/Reject activities', async () => {
    const database = makeDatabase()
    await expect(
      handleQuoteResponse({
        database,
        activity: { type: 'Follow', object: QUOTE_REQUEST_ID }
      })
    ).resolves.toBe(false)
  })
})
