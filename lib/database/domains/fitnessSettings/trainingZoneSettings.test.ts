import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The training zone inputs on the `general` fitness settings row: stored on
// create, changed one at a time on update, cleared with null, and left alone
// by an update that does not name them (a privacy save must not wipe them).
describe('FitnessSettings training zone fields', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let counter = 0

  const createActor = async () => {
    counter += 1
    const username = `zones${counter}`
    const actorId = `https://test.example.com/users/${username}`
    await database.createActor({
      actorId,
      username,
      domain: 'test.example.com',
      inboxUrl: `${actorId}/inbox`,
      followersUrl: `${actorId}/followers`,
      sharedInboxUrl: 'https://test.example.com/shared/inbox',
      publicKey: `test-public-key-${username}`,
      privateKey: `test-private-key-${username}`,
      createdAt: Date.now()
    })
    return actorId
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('stores and reads back the zone fields', async () => {
    const actorId = await createActor()
    const created = await database.createFitnessSettings({
      actorId,
      serviceType: 'general',
      maxHeartRate: 186,
      restingHeartRate: 52,
      functionalThresholdPower: 260
    })
    expect(created).toMatchObject({
      maxHeartRate: 186,
      restingHeartRate: 52,
      functionalThresholdPower: 260
    })

    const loaded = await database.getFitnessSettings({
      actorId,
      serviceType: 'general'
    })
    expect(loaded).toMatchObject({
      maxHeartRate: 186,
      restingHeartRate: 52,
      functionalThresholdPower: 260
    })
  })

  it('reads unset fields as undefined', async () => {
    const actorId = await createActor()
    await database.createFitnessSettings({ actorId, serviceType: 'general' })

    const loaded = await database.getFitnessSettings({
      actorId,
      serviceType: 'general'
    })
    expect(loaded?.maxHeartRate).toBeUndefined()
    expect(loaded?.restingHeartRate).toBeUndefined()
    expect(loaded?.functionalThresholdPower).toBeUndefined()
  })

  it('updates, clears and preserves the fields', async () => {
    const actorId = await createActor()
    const created = await database.createFitnessSettings({
      actorId,
      serviceType: 'general',
      maxHeartRate: 186,
      restingHeartRate: 52
    })

    const updated = await database.updateFitnessSettings({
      id: created.id,
      functionalThresholdPower: 245,
      restingHeartRate: null
    })
    expect(updated?.maxHeartRate).toBe(186)
    expect(updated?.restingHeartRate).toBeUndefined()
    expect(updated?.functionalThresholdPower).toBe(245)

    // A save of something else leaves the zones as they were.
    const unrelated = await database.updateFitnessSettings({
      id: created.id,
      generateRouteDescription: true
    })
    expect(unrelated).toMatchObject({
      maxHeartRate: 186,
      functionalThresholdPower: 245
    })
  })
})
