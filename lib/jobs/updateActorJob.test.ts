import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { UPDATE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { updateActorJob } from '@/lib/jobs/updateActorJob'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: vi.fn().mockResolvedValue(undefined)
}))

describe('updateActorJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(recordActorIfNeeded).mockClear()
  })

  it('forces a refresh of the stored remote actor that sent the update', async () => {
    await updateActorJob(database, {
      id: 'update-actor-1',
      name: UPDATE_ACTOR_JOB_NAME,
      data: { actorId: EXTERNAL_ACTOR1 },
      verifiedSenderActorId: EXTERNAL_ACTOR1
    })

    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      actorId: EXTERNAL_ACTOR1,
      database,
      forceRefresh: true
    })
  })

  it.each([
    {
      case: 'an actor this server never stored',
      actorId: 'https://unknown.test/users/stranger',
      verifiedSenderActorId: 'https://unknown.test/users/stranger'
    },
    {
      case: 'a local actor',
      actorId: ACTOR1_ID,
      verifiedSenderActorId: ACTOR1_ID
    },
    {
      case: 'an actor other than the signer',
      actorId: EXTERNAL_ACTOR1,
      verifiedSenderActorId: 'https://unknown.test/users/stranger'
    }
  ])('does not refresh $case', async ({ actorId, verifiedSenderActorId }) => {
    await updateActorJob(database, {
      id: 'update-actor-skip',
      name: UPDATE_ACTOR_JOB_NAME,
      data: { actorId },
      verifiedSenderActorId
    })

    expect(recordActorIfNeeded).not.toHaveBeenCalled()
  })
})
