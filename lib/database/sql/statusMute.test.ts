import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('StatusMuteDatabase', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('scopes conversation mutes to the (actor, status) pair for create, check, list and delete', async () => {
    const actorId = 'https://llun.test/users/mute-a'
    const otherActorId = 'https://llun.test/users/mute-b'
    await database.createStatusMute({ actorId, statusId: 'root-1' })
    // Muting an already-muted conversation is a no-op.
    await database.createStatusMute({ actorId, statusId: 'root-1' })
    await database.createStatusMute({ actorId, statusId: 'root-2' })
    await database.createStatusMute({
      actorId: otherActorId,
      statusId: 'root-1'
    })
    await database.createStatusMute({
      actorId: otherActorId,
      statusId: 'root-3'
    })

    expect(
      await database.isConversationMuted({ actorId, statusId: 'root-3' })
    ).toBe(false)
    expect(
      await database.isConversationMuted({
        actorId: otherActorId,
        statusId: 'root-2'
      })
    ).toBe(false)
    expect(
      (await database.getActorMutedConversationRootIds({ actorId })).sort()
    ).toEqual(['root-1', 'root-2'])

    await database.deleteStatusMute({ actorId, statusId: 'root-1' })
    expect(
      await database.isConversationMuted({ actorId, statusId: 'root-1' })
    ).toBe(false)
    expect(
      await database.isConversationMuted({ actorId, statusId: 'root-2' })
    ).toBe(true)
    expect(
      await database.isConversationMuted({
        actorId: otherActorId,
        statusId: 'root-1'
      })
    ).toBe(true)
  })
})
