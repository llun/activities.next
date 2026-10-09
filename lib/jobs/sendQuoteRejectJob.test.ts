import { ZodError } from 'zod'

import { sendQuoteReject } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_QUOTE_REJECT_JOB_NAME } from '@/lib/jobs/names'
import { sendQuoteRejectJob } from '@/lib/jobs/sendQuoteRejectJob'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/activities', () => ({
  sendQuoteReject: vi.fn()
}))

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn()
}))

const SIGNING_ACTOR = {
  id: 'https://llun.test/users/__instance__',
  domain: 'llun.test'
}
const QUOTER_ID = 'https://remote.test/users/quoter'
const QUOTED_STATUS_ID = `${ACTOR1_ID}/statuses/quoted`
const INSTRUMENT_ID = `${QUOTER_ID}/statuses/quoting`
const QUOTE_REQUEST_ID = `${INSTRUMENT_ID}#quote-request`

const jobData = (overrides: Record<string, unknown> = {}) => ({
  actorId: ACTOR1_ID,
  quotingActorId: QUOTER_ID,
  quoteRequestId: QUOTE_REQUEST_ID,
  quotedStatusId: QUOTED_STATUS_ID,
  instrumentId: INSTRUMENT_ID,
  ...overrides
})

describe('sendQuoteRejectJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(getFederationSigningActor).mockResolvedValue(
      SIGNING_ACTOR as never
    )
    vi.mocked(getActorPerson).mockResolvedValue({
      inbox: 'https://remote.test/inbox/quoter'
    } as never)
    vi.mocked(sendQuoteReject).mockResolvedValue(202 as never)
  })

  const runJob = (data: unknown) =>
    sendQuoteRejectJob(database, {
      id: 'quote-reject-job',
      name: SEND_QUOTE_REJECT_JOB_NAME,
      data
    })

  it('rejects the echoed QuoteRequest as the quoted author, to the quoter inbox', async () => {
    await runJob(jobData())

    expect(getActorPerson).toHaveBeenCalledWith({
      actorId: QUOTER_ID,
      signingActor: SIGNING_ACTOR
    })
    expect(sendQuoteReject).toHaveBeenCalledTimes(1)
    const params = vi.mocked(sendQuoteReject).mock.calls[0][0]
    expect(params.currentActor.id).toBe(ACTOR1_ID)
    expect(params.inbox).toBe('https://remote.test/inbox/quoter')
    expect(params.quoteRequest).toEqual({
      id: QUOTE_REQUEST_ID,
      type: 'QuoteRequest',
      actor: QUOTER_ID,
      object: QUOTED_STATUS_ID,
      instrument: INSTRUMENT_ID
    })
  })

  it('falls back to <quoter>/inbox when the quoter profile cannot be fetched', async () => {
    vi.mocked(getActorPerson).mockResolvedValue(null as never)

    await runJob(jobData())

    expect(sendQuoteReject).toHaveBeenCalledWith(
      expect.objectContaining({ inbox: `${QUOTER_ID}/inbox` })
    )
  })

  it('checks federation policy against the quoter and sends nothing when denied', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    await runJob(jobData())

    expect(canFederateWithDomain).toHaveBeenCalledWith(database, QUOTER_ID)
    expect(sendQuoteReject).not.toHaveBeenCalled()
  })

  it('sends nothing when the quoted author actor no longer exists', async () => {
    await runJob(jobData({ actorId: 'https://llun.test/users/missing' }))

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(sendQuoteReject).not.toHaveBeenCalled()
  })

  it('rejects a payload missing the quote request id', async () => {
    const { quoteRequestId: _id, ...withoutId } = jobData()

    await expect(runJob(withoutId)).rejects.toBeInstanceOf(ZodError)

    expect(sendQuoteReject).not.toHaveBeenCalled()
  })
})
