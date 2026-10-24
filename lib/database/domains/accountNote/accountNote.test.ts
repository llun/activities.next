import crypto from 'crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('AccountNoteDatabase', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  // Each test uses its own author so the tests don't depend on order.
  const author = (name: string) => `https://llun.test/users/note-${name}`
  const targetActorId = 'https://remote.test/users/note-target'
  const otherTarget = 'https://remote.test/users/other-target'

  const noteRows = (actorId: string, target: string) =>
    db
      .selectFrom('account_notes')
      .select('id')
      .where('actorId', '=', actorId)
      .where('targetActorId', '=', target)
      .execute()

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

  it('returns local note author ids for a given target actor', async () => {
    const target = `https://remote.test/users/note-target-${crypto.randomUUID()}`
    const localAuthorId = `https://llun.test/users/local-note-${crypto.randomUUID()}`
    const remoteAuthorId = `https://remote.test/users/remote-note-${crypto.randomUUID()}`

    // Create local actor with privateKey
    await database.createActor({
      actorId: localAuthorId,
      username: `local_${crypto.randomUUID().slice(0, 8)}`,
      domain: 'llun.test',
      publicKey: 'fake-public-key',
      privateKey: 'fake-private-key',
      inboxUrl: `${localAuthorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: `${localAuthorId}/followers`,
      createdAt: Date.now()
    })

    // Create remote actor without privateKey
    await database.createActor({
      actorId: remoteAuthorId,
      username: `remote_${crypto.randomUUID().slice(0, 8)}`,
      domain: 'remote.test',
      publicKey: 'fake-public-key',
      inboxUrl: `${remoteAuthorId}/inbox`,
      sharedInboxUrl: 'https://remote.test/inbox',
      followersUrl: `${remoteAuthorId}/followers`,
      createdAt: Date.now()
    })

    // Remote author has a note -> should NOT be returned
    await database.upsertAccountNote({
      actorId: remoteAuthorId,
      targetActorId: target,
      comment: 'remote note'
    })

    // Local author has an empty note (or no note) -> should NOT be returned
    let authors = await database.getLocalNoteAuthorIds({
      targetActorId: target
    })
    expect(authors).toEqual([])

    // Local author sets a note -> should be returned
    await database.upsertAccountNote({
      actorId: localAuthorId,
      targetActorId: target,
      comment: 'local note on target'
    })
    authors = await database.getLocalNoteAuthorIds({ targetActorId: target })
    expect(authors).toEqual([localAuthorId])

    // Local author clears the note -> should NOT be returned
    await database.upsertAccountNote({
      actorId: localAuthorId,
      targetActorId: target,
      comment: ''
    })
    authors = await database.getLocalNoteAuthorIds({ targetActorId: target })
    expect(authors).toEqual([])
  })
})
