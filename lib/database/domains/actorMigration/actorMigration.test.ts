import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('ActorMigrationDatabase', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  // SQLite timestamps have one-second precision: pin the age explicitly.
  const createAt = async (
    id: string,
    kind: 'move' | 'redirect',
    actorId: string,
    createdAt: Date
  ) => {
    await database.createActorMigration(params(id, kind, actorId))
    await testDb.db
      .updateTable('actor_migrations')
      .set({ createdAt })
      .where('id', '=', id)
      .execute()
  }

  const params = (
    id: string,
    kind: 'move' | 'redirect',
    actorId = 'https://llun.test/users/mover'
  ) => ({
    id,
    actorId,
    targetActorId: 'https://new.test/users/mover',
    targetAcct: 'mover@new.test',
    kind,
    followersCount: 7
  })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('creates a migration and returns it', async () => {
    const created = await database.createActorMigration(
      params('create-1', 'move', 'https://llun.test/users/create')
    )
    expect(created).toMatchObject({
      id: 'create-1',
      actorId: 'https://llun.test/users/create',
      targetActorId: 'https://new.test/users/mover',
      targetAcct: 'mover@new.test',
      kind: 'move',
      followersCount: 7
    })
    expect(created.createdAt).toBeGreaterThan(0)
  })

  it('lists migrations newest first, scoped to the actor, with a limit', async () => {
    const actorId = 'https://llun.test/users/list'
    await createAt('list-a', 'redirect', actorId, new Date('2026-01-01'))
    await createAt('list-b', 'move', actorId, new Date('2026-02-01'))
    await database.createActorMigration(
      params('list-other', 'move', 'https://llun.test/users/else')
    )

    const all = await database.getActorMigrations({ actorId })
    expect(all.map((m) => m.id)).toEqual(['list-b', 'list-a'])
    expect(
      (await database.getActorMigrations({ actorId, limit: 1 })).map(
        (m) => m.id
      )
    ).toEqual(['list-b'])
  })

  it('getLastActorMove ignores redirects and other actors', async () => {
    const actorId = 'https://llun.test/users/last'
    expect(await database.getLastActorMove({ actorId })).toBeNull()

    await createAt('last-move', 'move', actorId, new Date('2026-01-01'))
    await createAt('last-redirect', 'redirect', actorId, new Date('2026-02-01'))

    expect((await database.getLastActorMove({ actorId }))?.id).toBe('last-move')
    expect(
      await database.getLastActorMove({ actorId: 'https://llun.test/users/x' })
    ).toBeNull()
  })
})
