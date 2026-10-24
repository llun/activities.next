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

  describe('recordActorMigration', () => {
    const DAY = 24 * 60 * 60 * 1000
    const COOLDOWN = 30 * DAY
    const TARGET = 'https://new.test/users/mover'

    const newActor = async (name: string) => {
      const actorId = `https://llun.test/users/${name}`
      await database.createActor({
        actorId,
        username: name,
        domain: 'llun.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://llun.test/inbox',
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
      return actorId
    }
    const record = (
      id: string,
      actorId: string,
      kind: 'move' | 'redirect' = 'move',
      targetActorId = TARGET
    ) =>
      database.recordActorMigration({
        ...params(id, kind, actorId),
        targetActorId,
        cooldownMs: COOLDOWN
      })
    const rowCount = async (actorId: string) =>
      (await database.getActorMigrations({ actorId })).length

    it('inserts the row and sets movedTo together', async () => {
      const actorId = await newActor('rec-create')
      const result = await record('rec-create-1', actorId)
      expect(result).toMatchObject({
        status: 'created',
        migration: { id: 'rec-create-1', kind: 'move', targetActorId: TARGET }
      })
      expect((await database.getActorFromId({ id: actorId }))?.movedTo).toBe(
        TARGET
      )
      expect(await rowCount(actorId)).toBe(1)
    })

    it('reports no-actor without writing a row', async () => {
      const actorId = 'https://llun.test/users/rec-missing'
      expect(await record('rec-missing-1', actorId)).toEqual({
        status: 'no-actor'
      })
      expect(await rowCount(actorId)).toBe(0)
    })

    it('records one move for two concurrent calls', async () => {
      const actorId = await newActor('rec-race')
      const results = await Promise.all([
        record('rec-race-a', actorId),
        record('rec-race-b', actorId)
      ])
      expect(results.map((r) => r.status).sort()).toEqual([
        'created',
        'existing'
      ])
      expect(await rowCount(actorId)).toBe(1)
      const [created, existing] = [
        results.find((r) => r.status === 'created'),
        results.find((r) => r.status === 'existing')
      ]
      expect(existing).toMatchObject({
        migration: {
          id: (created as { migration: { id: string } }).migration.id
        }
      })
    })

    it('refuses a concurrent move to another target with the cooldown', async () => {
      const actorId = await newActor('rec-race-other')
      const results = await Promise.all([
        record('rec-ro-a', actorId, 'move', TARGET),
        record('rec-ro-b', actorId, 'move', 'https://third.test/users/mover')
      ])
      expect(results.map((r) => r.status).sort()).toEqual([
        'cooldown',
        'created'
      ])
      expect(await rowCount(actorId)).toBe(1)
    })

    it('returns the existing row for the same target while movedTo holds', async () => {
      const actorId = await newActor('rec-retry')
      const first = await record('rec-retry-1', actorId)
      const again = await record('rec-retry-2', actorId)
      expect(again.status).toBe('existing')
      expect(again).toMatchObject({
        migration: {
          id: (first as { migration: { id: string } }).migration.id
        }
      })
      expect(await rowCount(actorId)).toBe(1)
    })

    it('answers cooldown for the same target once the move was started', async () => {
      const actorId = await newActor('rec-started')
      const first = await record('rec-started-1', actorId)
      const id = (first as { migration: { id: string } }).migration.id
      expect(
        (await database.getActorMigrations({ actorId }))[0].startedAt
      ).toBeNull()

      await database.markActorMigrationStarted({ id })
      const started = (await database.getActorMigrations({ actorId }))[0]
      expect(started.startedAt).toBeGreaterThan(0)

      // A second mark keeps the first time.
      await database.markActorMigrationStarted({ id })
      expect(
        (await database.getActorMigrations({ actorId }))[0].startedAt
      ).toBe(started.startedAt)

      const again = await record('rec-started-2', actorId)
      expect(again.status).toBe('cooldown')
      expect(await rowCount(actorId)).toBe(1)
    })

    it('answers cooldown once a redirect to the same target is newer than the unstarted move', async () => {
      const actorId = await newActor('rec-redirected')
      await record('rec-redirected-1', actorId)
      await database.updateActor({ actorId, movedTo: null })
      await record('rec-redirected-2', actorId, 'redirect')
      expect((await database.getActorFromId({ id: actorId }))?.movedTo).toBe(
        TARGET
      )

      const result = await record('rec-redirected-3', actorId)
      expect(result.status).toBe('cooldown')
      expect(await rowCount(actorId)).toBe(2)
    })

    it('answers cooldown for the same target once movedTo was cleared', async () => {
      const actorId = await newActor('rec-cleared')
      await record('rec-cleared-1', actorId)
      await database.updateActor({ actorId, movedTo: null })
      const result = await record('rec-cleared-2', actorId)
      expect(result.status).toBe('cooldown')
      expect(await rowCount(actorId)).toBe(1)
      expect((await database.getActorFromId({ id: actorId }))?.movedTo).toBe(
        undefined
      )
    })

    it('answers cooldown for another target', async () => {
      const actorId = await newActor('rec-other')
      await record('rec-other-1', actorId)
      const result = await record(
        'rec-other-2',
        actorId,
        'move',
        'https://third.test/users/mover'
      )
      expect(result.status).toBe('cooldown')
      expect(await rowCount(actorId)).toBe(1)
    })

    it('keeps the cooldown boundary exact', async () => {
      const actorId = await newActor('rec-boundary')
      const setAge = (createdAt: Date) =>
        testDb.db
          .updateTable('actor_migrations')
          .set({ createdAt })
          .where('actorId', '=', actorId)
          .execute()
      const other = 'https://third.test/users/mover'

      await record('rec-boundary-1', actorId)
      // One minute left of the cooldown: still refused.
      const justInside = Date.now() - COOLDOWN + 60 * 1000
      await setAge(new Date(justInside))
      expect(await record('rec-boundary-2', actorId, 'move', other)).toEqual({
        status: 'cooldown',
        until: justInside + COOLDOWN
      })
      // One minute past it: allowed.
      await setAge(new Date(Date.now() - COOLDOWN - 60 * 1000))
      expect(
        (await record('rec-boundary-3', actorId, 'move', other)).status
      ).toBe('created')
    })

    it('writes explicit timestamps that read back as the current time', async () => {
      const actorId = await newActor('rec-time')
      const before = Date.now()
      const result = await record('rec-time-1', actorId)
      const createdAt = (result as { migration: { createdAt: number } })
        .migration.createdAt
      expect(createdAt).toBeGreaterThanOrEqual(before - 1)
      expect(createdAt).toBeLessThanOrEqual(Date.now() + 1)
    })

    it('records a redirect without a cooldown check', async () => {
      const actorId = await newActor('rec-redirect')
      await record('rec-redirect-1', actorId, 'move')
      const result = await record('rec-redirect-2', actorId, 'redirect')
      expect(result.status).toBe('created')
      expect(await rowCount(actorId)).toBe(2)
    })
  })
})
