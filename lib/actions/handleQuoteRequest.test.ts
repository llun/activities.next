import { handleQuoteRequest } from '@/lib/actions/handleQuoteRequest'
import type { Database } from '@/lib/database/types'
import {
  SEND_QUOTE_ACCEPT_JOB_NAME,
  SEND_QUOTE_REJECT_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const INBOX_ACTOR_ID = 'https://llun.test/users/target'
const QUOTER = 'https://remote.example/users/quoter'
const QUOTED_STATUS_ID = 'https://llun.test/users/target/statuses/1'
const INSTRUMENT_ID = 'https://remote.example/users/quoter/statuses/9'

const inboxActor = { id: INBOX_ACTOR_ID } as Actor

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: `${INSTRUMENT_ID}/quote-request`,
  type: 'QuoteRequest',
  actor: QUOTER,
  object: QUOTED_STATUS_ID,
  instrument: INSTRUMENT_ID,
  ...overrides
})

const makeDatabase = (
  overrides: Partial<{
    quotedStatus: unknown
    createSpy: ReturnType<typeof vi.fn>
    eitherBlocking: boolean
    follow: { status: string } | null
  }> = {}
): Database =>
  ({
    getStatus: vi.fn().mockResolvedValue(
      overrides.quotedStatus === undefined
        ? {
            type: 'Note',
            actorId: INBOX_ACTOR_ID,
            isLocalActor: true,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            quoteApprovalPolicy: 'public'
          }
        : overrides.quotedStatus
    ),
    createStatusQuote: overrides.createSpy ?? vi.fn().mockResolvedValue({}),
    getActorFromId: vi.fn().mockResolvedValue({ id: QUOTER }),
    isEitherBlocking: vi
      .fn()
      .mockResolvedValue(overrides.eitherBlocking ?? false),
    getAcceptedOrRequestedFollow: vi
      .fn()
      .mockResolvedValue(overrides.follow ?? null)
  }) as unknown as Database

describe('handleQuoteRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts an authorized request, records the accepted edge, and enqueues Accept', async () => {
    const createSpy = vi.fn().mockResolvedValue({})
    const database = makeDatabase({ createSpy })
    const handled = await handleQuoteRequest({
      database,
      activity: activity(),
      inboxActor
    })

    expect(handled).toBe(true)
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: INSTRUMENT_ID,
        quotedStatusId: QUOTED_STATUS_ID,
        state: 'accepted',
        quoteRequestId: `${INSTRUMENT_ID}/quote-request`,
        authorizationUri: expect.stringContaining(
          `${INBOX_ACTOR_ID}/quote_authorizations/`
        )
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_QUOTE_ACCEPT_JOB_NAME })
    )
  })

  it('rejects when the policy denies, recording a rejected edge and enqueueing Reject', async () => {
    const createSpy = vi.fn().mockResolvedValue({})
    const database = makeDatabase({
      createSpy,
      quotedStatus: {
        type: 'Note',
        actorId: INBOX_ACTOR_ID,
        isLocalActor: true,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        quoteApprovalPolicy: 'nobody'
      }
    })
    const handled = await handleQuoteRequest({
      database,
      activity: activity(),
      inboxActor
    })

    expect(handled).toBe(true)
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'rejected' })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_QUOTE_REJECT_JOB_NAME })
    )
  })

  it('returns false when the quoted status is not local', async () => {
    const createSpy = vi.fn()
    const database = makeDatabase({
      createSpy,
      quotedStatus: {
        type: 'Note',
        actorId: 'https://other.example/users/x',
        isLocalActor: false
      }
    })
    const handled = await handleQuoteRequest({
      database,
      activity: activity(),
      inboxActor
    })
    expect(handled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('returns false when the quoted status is not owned by the inbox actor', async () => {
    const database = makeDatabase({
      quotedStatus: {
        type: 'Note',
        actorId: 'https://llun.test/users/someone-else',
        isLocalActor: true
      }
    })
    await expect(
      handleQuoteRequest({ database, activity: activity(), inboxActor })
    ).resolves.toBe(false)
  })

  it('returns false when the instrument author disagrees with the requester', async () => {
    const database = makeDatabase()
    const handled = await handleQuoteRequest({
      database,
      activity: activity({
        instrument: {
          id: INSTRUMENT_ID,
          attributedTo: 'https://evil.example/x'
        }
      }),
      inboxActor
    })
    expect(handled).toBe(false)
  })

  it('returns false when a bare-id instrument is hosted on a foreign authority', async () => {
    const createSpy = vi.fn()
    const database = makeDatabase({ createSpy })
    const handled = await handleQuoteRequest({
      database,
      activity: activity({
        instrument: 'https://evil.example/users/mallory/statuses/1'
      }),
      inboxActor
    })
    expect(handled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('returns false when the instrument is on our own host (never inbound)', async () => {
    // getConfig().host is 'test.llun.dev' under the test config mock.
    const createSpy = vi.fn()
    const database = makeDatabase({ createSpy })
    const handled = await handleQuoteRequest({
      database,
      activity: activity({
        actor: 'https://test.llun.dev/users/mallory',
        instrument: 'https://test.llun.dev/users/carol/statuses/1'
      }),
      inboxActor
    })
    expect(handled).toBe(false)
    expect(createSpy).not.toHaveBeenCalled()
  })
})
