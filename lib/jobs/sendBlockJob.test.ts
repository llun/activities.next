import { ZodError } from 'zod'

import { block } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_BLOCK_JOB_NAME } from '@/lib/jobs/names'
import { sendBlockJob } from '@/lib/jobs/sendBlockJob'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/activities', () => ({
  block: vi.fn()
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
const TARGET_ID = 'https://remote.test/users/blocked'
const MISSING_ACTOR_ID = 'https://llun.test/users/missing'
const BLOCK_URI = `${ACTOR1_ID}#blocks/current`

describe('sendBlockJob', () => {
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
    vi.mocked(block).mockResolvedValue({ ok: true, uri: BLOCK_URI })
    for (const actorId of [ACTOR1_ID, MISSING_ACTOR_ID]) {
      await database.deleteBlock({ actorId, targetActorId: TARGET_ID })
    }
  })

  const runJob = (data: unknown) =>
    sendBlockJob(database, {
      id: 'block-job',
      name: SEND_BLOCK_JOB_NAME,
      data
    })

  const jobData = (overrides: Record<string, unknown> = {}) => ({
    actorId: ACTOR1_ID,
    targetActorId: TARGET_ID,
    uri: BLOCK_URI,
    ...overrides
  })

  it('delivers the persisted Block as the blocking actor, resolving the target inbox with the instance signer', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: BLOCK_URI
    })

    await runJob(jobData())

    expect(block).toHaveBeenCalledTimes(1)
    const params = vi.mocked(block).mock.calls[0][0]
    expect(params).toMatchObject({
      uri: BLOCK_URI,
      targetActorId: TARGET_ID,
      signingActor: SIGNING_ACTOR
    })
    expect(params.currentActor.id).toBe(ACTOR1_ID)
  })

  it('checks federation policy against the blocked actor and sends nothing when federation is denied', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: BLOCK_URI
    })

    await runJob(jobData())

    expect(canFederateWithDomain).toHaveBeenCalledWith(database, TARGET_ID)
    expect(block).not.toHaveBeenCalled()
  })

  it('sends nothing when the blocking actor no longer exists', async () => {
    // The block row matches the job exactly, so only the missing actor can
    // stop the send.
    await database.createBlock({
      actorId: MISSING_ACTOR_ID,
      targetActorId: TARGET_ID,
      uri: BLOCK_URI
    })

    await runJob(jobData({ actorId: MISSING_ACTOR_ID }))

    expect(block).not.toHaveBeenCalled()
  })

  it('skips a stale job when the block was removed before the job ran', async () => {
    await runJob(jobData())

    expect(block).not.toHaveBeenCalled()
  })

  it('skips a stale job when the block was re-created under a newer uri', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: `${ACTOR1_ID}#blocks/newer`
    })

    await runJob(jobData())

    expect(block).not.toHaveBeenCalled()
  })

  it('throws when the remote inbox rejects the Block so the queue retries', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: TARGET_ID,
      uri: BLOCK_URI
    })
    vi.mocked(block).mockResolvedValue({ ok: false, uri: BLOCK_URI })

    await expect(runJob(jobData())).rejects.toThrow('Failed to send Block')
  })

  it('rejects a malformed payload before doing any work', async () => {
    await expect(runJob({ actorId: ACTOR1_ID })).rejects.toBeInstanceOf(
      ZodError
    )

    expect(canFederateWithDomain).not.toHaveBeenCalled()
    expect(block).not.toHaveBeenCalled()
  })
})
