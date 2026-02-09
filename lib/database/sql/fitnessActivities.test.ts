import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('FitnessActivities database operations', () => {
  let database: Awaited<ReturnType<typeof getTestSQLDatabase>>

  const actorId = 'https://fitness.example.com/users/runner'
  const actorUsername = 'runner'

  beforeAll(async () => {
    database = getTestSQLDatabase()
    await database.migrate()

    await database.createActor({
      actorId,
      username: actorUsername,
      domain: 'fitness.example.com',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://fitness.example.com/inbox',
      followersUrl: `${actorId}/followers`,
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      createdAt: Date.now()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns fitness activity by statusId', async () => {
    const statusId = `${actorId}/statuses/fitness-lookup`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      text: 'Linked fitness activity status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createFitnessActivity({
      id: 'fitness-lookup-1',
      actorId,
      stravaActivityId: 987654,
      statusId,
      name: 'Evening Ride',
      type: 'Ride',
      sportType: 'Ride',
      startDate: new Date('2026-02-08T10:00:00.000Z'),
      distance: 25000,
      movingTime: 3600
    })

    const activity = await database.getFitnessActivityByStatusId({ statusId })
    expect(activity).not.toBeNull()
    expect(activity?.id).toBe('fitness-lookup-1')
    expect(activity?.statusId).toBe(statusId)
    expect(activity?.stravaActivityId).toBe(987654)
  })

  it('returns null when no fitness activity is linked to the status', async () => {
    const statusId = `${actorId}/statuses/no-fitness-lookup`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      text: 'Status with no linked fitness activity',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const activity = await database.getFitnessActivityByStatusId({ statusId })
    expect(activity).toBeNull()
  })
})
