import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('AccountNoteDatabase', () => {
  const testDb = createTestDatabase()
  const { database, knex } = testDb

  // Each test uses its own author so the tests don't depend on order.
  const author = (name: string) => `https://llun.test/users/note-${name}`
  const targetActorId = 'https://remote.test/users/note-target'
  const otherTarget = 'https://remote.test/users/other-target'

  const noteRows = (actorId: string, target: string) =>
    knex('account_notes').where({ actorId, targetActorId: target }).select('id')

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('returns an empty string when there is no note for the target', async () => {
    const actorId = author('miss')
    await database.upsertAccountNote({
      actorId,
      targetActorId: otherTarget,
      comment: 'a note on someone else'
    })

    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('')
  })

  it('stores a trimmed note, replaces it, and deletes it on an empty comment', async () => {
    const actorId = author('lifecycle')
    await expect(
      database.upsertAccountNote({
        actorId,
        targetActorId,
        comment: '  first note  '
      })
    ).resolves.toBe('first note')
    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('first note')

    // The second write takes the (actorId, targetActorId) conflict path.
    await expect(
      database.upsertAccountNote({
        actorId,
        targetActorId,
        comment: '  second note  '
      })
    ).resolves.toBe('second note')
    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('second note')
    await expect(noteRows(actorId, targetActorId)).resolves.toHaveLength(1)

    await expect(
      database.upsertAccountNote({ actorId, targetActorId, comment: '   ' })
    ).resolves.toBe('')
    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('')
    // Cleared means deleted, not stored as an empty comment.
    await expect(noteRows(actorId, targetActorId)).resolves.toEqual([])
  })

  it('keeps notes for different targets apart, including when one is cleared', async () => {
    const actorId = author('targets')
    await database.upsertAccountNote({
      actorId,
      targetActorId: otherTarget,
      comment: 'other'
    })
    await database.upsertAccountNote({
      actorId,
      targetActorId,
      comment: 'mine'
    })

    await expect(
      database.getAccountNote({ actorId, targetActorId: otherTarget })
    ).resolves.toBe('other')
    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('mine')

    await database.upsertAccountNote({ actorId, targetActorId, comment: '' })
    await expect(
      database.getAccountNote({ actorId, targetActorId: otherTarget })
    ).resolves.toBe('other')
  })

  it('keeps notes by different authors on the same target apart', async () => {
    const actorId = author('author-a')
    const otherAuthor = author('author-b')
    await database.upsertAccountNote({
      actorId: otherAuthor,
      targetActorId,
      comment: 'theirs'
    })

    await expect(
      database.getAccountNote({ actorId, targetActorId })
    ).resolves.toBe('')

    await database.upsertAccountNote({ actorId, targetActorId, comment: 'x' })
    await database.upsertAccountNote({ actorId, targetActorId, comment: '' })
    await expect(
      database.getAccountNote({ actorId: otherAuthor, targetActorId })
    ).resolves.toBe('theirs')
  })
})
