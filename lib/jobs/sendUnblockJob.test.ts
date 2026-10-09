import { unblock } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { sendUnblockJob } from '@/lib/jobs/sendUnblockJob'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Block } from '@/lib/types/domain/block'

vi.mock('@/lib/activities', () => ({
  unblock: vi.fn()
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
const TARGET_ID = 'https://remote.test/users/unblocked'
const BLOCK_URI = `${ACTOR1_ID}#blocks/removed`

const removedBlock: Block = {
  id: 'block-1',
  actorId: ACTOR1_ID,
  actorHost: 'llun.test',
  targetActorId: TARGET_ID,
  targetActorHost: 'remote.test',
  uri: BLOCK_URI,
  createdAt: 1,
  updatedAt: 1
}

describe('sendUnblockJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(getFederationSigningActor).mockResolvedValue(
      SIGNING_ACTOR as never
    )
    vi.mocked(unblock).mockResolvedValue(true)
    await database.deleteBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID
    })
  })

  const runJob = (data: unknown) =>
    sendUnblockJob(database, {
      id: 'unblock-job',
      name: SEND_UNBLOCK_JOB_NAME,
      data
    })

  const jobData = (overrides: Record<string, unknown> = {}) => ({
    actorId: ACTOR1_ID,
    block: removedBlock,
    ...overrides
  })

  it('sends an Undo of the removed Block as the unblocking actor with the instance signer', async () => {
    await runJob(jobData())

    expect(unblock).toHaveBeenCalledTimes(1)
    const [currentActor, sentBlock, signingActor] =
      vi.mocked(unblock).mock.calls[0]
    expect(currentActor.id).toBe(ACTOR1_ID)
    expect(sentBlock).toEqual(removedBlock)
    expect(signingActor).toEqual(SIGNING_ACTOR)
  })

  it('still sends the Undo when the persisted block carries the same uri', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: BLOCK_URI
    })

    await runJob(jobData())

    expect(unblock).toHaveBeenCalledTimes(1)
  })

  it('skips a stale Undo when the target was blocked again under a new uri', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: `${ACTOR1_ID}#blocks/reblocked`
    })

    await runJob(jobData())

    expect(unblock).not.toHaveBeenCalled()
  })

  it('checks federation policy against the unblocked actor and sends nothing when denied', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    await runJob(jobData())

    expect(canFederateWithDomain).toHaveBeenCalledWith(database, TARGET_ID)
    expect(unblock).not.toHaveBeenCalled()
  })

  it('sends nothing when the unblocking actor no longer exists', async () => {
    await runJob(jobData({ actorId: 'https://llun.test/users/missing' }))

    expect(unblock).not.toHaveBeenCalled()
  })

  it('throws when the remote inbox rejects the Undo so the queue retries', async () => {
    vi.mocked(unblock).mockResolvedValue(false)

    await expect(runJob(jobData())).rejects.toThrow('Failed to send Undo Block')
  })

  it('rejects a payload whose block is malformed', async () => {
    await expect(
      runJob(jobData({ block: { id: 'block-1' } }))
    ).rejects.toThrow()

    expect(unblock).not.toHaveBeenCalled()
  })
})
