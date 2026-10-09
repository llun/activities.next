import { getNote, sendQuoteRequest } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_QUOTE_REQUEST_JOB_NAME } from '@/lib/jobs/names'
import { sendQuoteRequestJob } from '@/lib/jobs/sendQuoteRequestJob'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/activities', () => ({
  getNote: vi.fn(),
  sendQuoteRequest: vi.fn()
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
const REMOTE_AUTHOR_ID = 'https://remote.test/users/author'
const QUOTED_STATUS_ID = `${REMOTE_AUTHOR_ID}/statuses/quoted`

describe('sendQuoteRequestJob', () => {
  const database = getTestSQLDatabase()
  let counter = 0

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
      inbox: `${REMOTE_AUTHOR_ID}/inbox`
    } as never)
    vi.mocked(getNote).mockResolvedValue(null)
    vi.mocked(sendQuoteRequest).mockResolvedValue(202 as never)
  })

  // The local quoting note; the quoted remote note is optionally cached too.
  const seedQuotingStatus = async () => {
    counter += 1
    const id = `${ACTOR1_ID}/statuses/quote-request-${counter}`
    await database.createNote({
      id,
      url: id,
      actorId: ACTOR1_ID,
      text: 'quoting a remote note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    return id
  }

  const cacheQuotedStatus = (id: string, actorId: string) =>
    database.createNote({
      id,
      url: id,
      actorId,
      text: 'the quoted note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

  const runJob = (data: unknown) =>
    sendQuoteRequestJob(database, {
      id: 'quote-request-job',
      name: SEND_QUOTE_REQUEST_JOB_NAME,
      data
    })

  const jobData = (statusId: string, quotedStatusId = QUOTED_STATUS_ID) => ({
    actorId: ACTOR1_ID,
    statusId,
    quotedStatusId
  })

  it('sends the QuoteRequest with the quoting note as instrument to the cached quoted author inbox', async () => {
    const statusId = await seedQuotingStatus()
    await database.createActor({
      actorId: REMOTE_AUTHOR_ID,
      username: 'author',
      domain: 'remote.test',
      followersUrl: `${REMOTE_AUTHOR_ID}/followers`,
      inboxUrl: `${REMOTE_AUTHOR_ID}/inbox`,
      sharedInboxUrl: 'https://remote.test/inbox',
      publicKey: 'public-key',
      createdAt: Date.now()
    })
    await cacheQuotedStatus(QUOTED_STATUS_ID, REMOTE_AUTHOR_ID)

    await runJob(jobData(statusId))

    expect(sendQuoteRequest).toHaveBeenCalledTimes(1)
    const params = vi.mocked(sendQuoteRequest).mock.calls[0][0]
    expect(params).toMatchObject({
      inbox: `${REMOTE_AUTHOR_ID}/inbox`,
      quoteRequestId: `${statusId}#quote-request`,
      quotedStatusId: QUOTED_STATUS_ID
    })
    expect(params.currentActor.id).toBe(ACTOR1_ID)
    expect(params.instrument).toMatchObject({
      id: statusId,
      attributedTo: ACTOR1_ID
    })
    // The cached copy answers; the remote note is not dereferenced.
    expect(getNote).not.toHaveBeenCalled()
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId: REMOTE_AUTHOR_ID,
      signingActor: SIGNING_ACTOR
    })
  })

  it('dereferences the quoted note for its author when it is not cached locally', async () => {
    const statusId = await seedQuotingStatus()
    const uncachedId = 'https://other.test/users/someone/statuses/uncached'
    vi.mocked(getNote).mockResolvedValue({
      id: uncachedId,
      attributedTo: 'https://other.test/users/someone'
    } as never)
    vi.mocked(getActorPerson).mockResolvedValue({
      inbox: 'https://other.test/users/someone/inbox'
    } as never)

    await runJob(jobData(statusId, uncachedId))

    expect(getNote).toHaveBeenCalledWith({
      statusId: uncachedId,
      signingActor: SIGNING_ACTOR
    })
    expect(sendQuoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        inbox: 'https://other.test/users/someone/inbox',
        quotedStatusId: uncachedId
      })
    )
  })

  it('falls back to <author>/inbox when the author profile cannot be fetched', async () => {
    const statusId = await seedQuotingStatus()
    const uncachedId = 'https://other.test/users/someone/statuses/no-profile'
    vi.mocked(getNote).mockResolvedValue({
      id: uncachedId,
      attributedTo: 'https://other.test/users/someone'
    } as never)
    vi.mocked(getActorPerson).mockResolvedValue(null as never)

    await runJob(jobData(statusId, uncachedId))

    expect(sendQuoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        inbox: 'https://other.test/users/someone/inbox'
      })
    )
  })

  it.each([
    ['the note cannot be fetched', null],
    ['the note has no single attributedTo string', { attributedTo: ['a', 'b'] }]
  ])('sends nothing when %s', async (_title, note) => {
    const statusId = await seedQuotingStatus()
    vi.mocked(getNote).mockResolvedValue(note as never)

    await runJob(jobData(statusId, 'https://other.test/statuses/unknown'))

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(sendQuoteRequest).not.toHaveBeenCalled()
  })

  it('checks federation policy against the quoted status and sends nothing when denied', async () => {
    const statusId = await seedQuotingStatus()
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    await runJob(jobData(statusId))

    expect(canFederateWithDomain).toHaveBeenCalledWith(
      database,
      QUOTED_STATUS_ID
    )
    expect(sendQuoteRequest).not.toHaveBeenCalled()
  })

  it('sends nothing when the quoting status no longer exists', async () => {
    await runJob(jobData(`${ACTOR1_ID}/statuses/deleted-before-job`))

    expect(sendQuoteRequest).not.toHaveBeenCalled()
  })

  it('sends nothing when the quoting status is a poll, which cannot be an instrument', async () => {
    const pollId = `${ACTOR1_ID}/statuses/quote-poll`
    await database.createPoll({
      id: pollId,
      url: pollId,
      actorId: ACTOR1_ID,
      text: 'poll',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: ['Yes', 'No'],
      endAt: Date.now() + 60_000
    })

    await runJob(jobData(pollId))

    expect(sendQuoteRequest).not.toHaveBeenCalled()
  })

  it('rejects a payload missing the quoted status id', async () => {
    await expect(
      runJob({ actorId: ACTOR1_ID, statusId: 'x' })
    ).rejects.toThrow()

    expect(sendQuoteRequest).not.toHaveBeenCalled()
  })
})
