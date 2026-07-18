import { sendQuoteRevoke } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_QUOTE_REVOKE_JOB_NAME } from '@/lib/jobs/names'
import { sendQuoteRevokeJob } from '@/lib/jobs/sendQuoteRevokeJob'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/activities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/activities')>()),
  sendQuoteRevoke: vi.fn().mockResolvedValue(undefined)
}))

// Resolve any actor's inbox to <actorId>/inbox without a network fetch.
vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn(({ actorId }: { actorId: string }) =>
    Promise.resolve({ inbox: `${actorId}/inbox` })
  )
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(null)
}))

const REMOTE_QUOTER_ID = 'https://remote.example/users/quoter'
const MENTIONED_ACTOR_ID = 'https://mention.example/users/bob'
const MENTIONED_SHARED_INBOX = 'https://mention.example/inbox'
const STAMP_ID = `${ACTOR1_ID}/quote_authorizations/fanout`

describe('sendQuoteRevokeJob', () => {
  const database = getTestSQLDatabase()
  const mockSendQuoteRevoke = sendQuoteRevoke as jest.MockedFunction<
    typeof sendQuoteRevoke
  >
  let counter = 0

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createActor({
      actorId: REMOTE_QUOTER_ID,
      username: 'quoter',
      domain: 'remote.example',
      followersUrl: `${REMOTE_QUOTER_ID}/followers`,
      inboxUrl: `${REMOTE_QUOTER_ID}/inbox`,
      sharedInboxUrl: 'https://remote.example/inbox',
      publicKey: 'public-key',
      createdAt: Date.now()
    })
    await database.createActor({
      actorId: MENTIONED_ACTOR_ID,
      username: 'bob',
      domain: 'mention.example',
      followersUrl: `${MENTIONED_ACTOR_ID}/followers`,
      inboxUrl: `${MENTIONED_ACTOR_ID}/inbox`,
      sharedInboxUrl: MENTIONED_SHARED_INBOX,
      publicKey: 'public-key',
      createdAt: Date.now()
    })
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(() => {
    mockSendQuoteRevoke.mockClear()
  })

  const seedQuoting = async (cc: string[]) => {
    counter += 1
    const quotingStatusId = `${REMOTE_QUOTER_ID}/statuses/revoke-fanout-${counter}`
    await database.createNote({
      id: quotingStatusId,
      url: quotingStatusId,
      actorId: REMOTE_QUOTER_ID,
      text: 'quoting you',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc
    })
    return quotingStatusId
  }

  const runJob = (quotingStatusId?: string) =>
    sendQuoteRevokeJob(database, {
      id: 'revoke-job',
      name: SEND_QUOTE_REVOKE_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        quotingActorId: REMOTE_QUOTER_ID,
        ...(quotingStatusId ? { quotingStatusId } : {}),
        stampId: STAMP_ID
      }
    })

  const sentInboxes = () =>
    mockSendQuoteRevoke.mock.calls.map((c) => c[0].inbox)

  it('fans the stamp Delete out to the quoting note recipients and the quoting author', async () => {
    const quotingStatusId = await seedQuoting([MENTIONED_ACTOR_ID])

    await runJob(quotingStatusId)

    const inboxes = sentInboxes()
    expect(inboxes).toContain(`${REMOTE_QUOTER_ID}/inbox`)
    expect(inboxes).toContain(MENTIONED_SHARED_INBOX)
  })

  it('signs every fanned-out Delete as the quoted author', async () => {
    const quotingStatusId = await seedQuoting([MENTIONED_ACTOR_ID])

    await runJob(quotingStatusId)

    expect(mockSendQuoteRevoke).toHaveBeenCalled()
    for (const call of mockSendQuoteRevoke.mock.calls) {
      expect(call[0].currentActor.id).toBe(ACTOR1_ID)
      expect(call[0].stampId).toBe(STAMP_ID)
    }
  })

  it('delivers only to the quoting author when the note has no other recipients', async () => {
    const quotingStatusId = await seedQuoting([])

    await runJob(quotingStatusId)

    const inboxes = sentInboxes()
    expect(inboxes).toEqual([`${REMOTE_QUOTER_ID}/inbox`])
  })

  it('falls back to author-only delivery when no quotingStatusId is provided', async () => {
    await runJob()

    const inboxes = sentInboxes()
    expect(inboxes).toEqual([`${REMOTE_QUOTER_ID}/inbox`])
  })
})
