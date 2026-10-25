import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

// The handle ledger: what the mint paths write, what it reserves, how an old
// handle resolves, what deletion keeps, and the rename transaction's every
// refusal and success shape.
describe('actorHandle domain', () => {
  const withFreshDatabase = async (
    test: (database: Database, db: Db) => Promise<void>
  ) => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    const { database } = testDb
    await database.migrate()
    try {
      await test(database, testDb.db)
    } finally {
      await database.destroy()
    }
  }

  // createAccount returns the ACCOUNT id; the tests below need the minted
  // ACTOR id, read back through the account's actors.
  const createLocalAccount = async (
    database: Database,
    username: string,
    email = `${username}-${crypto.randomUUID()}@${TEST_DOMAIN}`
  ) => {
    const accountId = await database.createAccount({
      email,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return actors[0].id
  }

  const createRemoteActor = (database: Database, username: string) => {
    const actorId = `https://remote.test/users/${username}`
    return database
      .createActor({
        actorId,
        username,
        domain: 'remote.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote.test/inbox',
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      .then(() => actorId)
  }

  const rename = (
    database: Database,
    actorId: string,
    username: string,
    now = new Date('2026-01-01T00:00:00.000Z'),
    cooldownMs = 30 * 24 * 60 * 60 * 1000
  ) =>
    database.recordActorHandleRename({
      actorId,
      username,
      domain: TEST_DOMAIN,
      now,
      cooldownMs
    })

  it('createAccount inserts the current ledger row', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'minted')

      await expect(
        database.getCurrentActorHandle({ actorId })
      ).resolves.toMatchObject({
        actorId,
        username: 'minted',
        domain: TEST_DOMAIN,
        replacedAt: null
      })
    }))

  it('createActorForAccount inserts the current ledger row for the new actor', () =>
    withFreshDatabase(async (database) => {
      const accountId = await database.createAccount({
        email: `owner-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        username: 'owner',
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'private-key-owner',
        publicKey: 'public-key-owner'
      })
      const actorId = await database.createActorForAccount({
        accountId,
        username: 'second',
        domain: TEST_DOMAIN,
        privateKey: 'private-key-second',
        publicKey: 'public-key-second'
      })

      await expect(
        database.getCurrentActorHandle({ actorId })
      ).resolves.toMatchObject({ username: 'second', replacedAt: null })
    }))

  it('the remote createActor path never writes the ledger', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createRemoteActor(database, 'visitor')

      await expect(database.getActorHandles({ actorId })).resolves.toEqual([])
    }))

  it('refuses a mint onto a handle a replaced ledger row holds, in any casing', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'original')
      await rename(database, actorId, 'renamed')

      // The actors row no longer holds 'original', only the ledger does.
      await expect(createLocalAccount(database, 'original')).rejects.toThrow()
      await expect(createLocalAccount(database, 'ORIGINAL')).rejects.toThrow()
      const otherAccountId = await database.createAccount({
        email: `other-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        username: 'otherholder',
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'private-key-other',
        publicKey: 'public-key-other'
      })
      await expect(
        database.createActorForAccount({
          accountId: otherAccountId,
          username: 'Original',
          domain: TEST_DOMAIN,
          privateKey: 'private-key-x',
          publicKey: 'public-key-x'
        })
      ).rejects.toThrow()
    }))

  it('isUsernameExists reports a replaced handle taken, including the upper-case variant', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'holder')
      await rename(database, actorId, 'newname')

      await expect(
        database.isUsernameExists({ username: 'holder', domain: TEST_DOMAIN })
      ).resolves.toBe(true)
      await expect(
        database.isUsernameExists({ username: 'HOLDER', domain: TEST_DOMAIN })
      ).resolves.toBe(true)
    }))

  it('isUsernameExists still reports a free name as free', () =>
    withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'taken-name')

      await expect(
        database.isUsernameExists({ username: 'free', domain: TEST_DOMAIN })
      ).resolves.toBe(false)
    }))

  it('getActorFromUsername finds the renamed actor by its old handle, in any casing', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'historical')
      await rename(database, actorId, 'modern')

      await expect(
        database.getActorFromUsername({
          username: 'historical',
          domain: TEST_DOMAIN
        })
      ).resolves.toMatchObject({ id: actorId, username: 'modern' })
      await expect(
        database.getActorFromUsername({
          username: 'HISTORICAL',
          domain: TEST_DOMAIN
        })
      ).resolves.toMatchObject({ id: actorId })
    }))

  it('the history arm does not shadow a live actor whose current handle it is', () =>
    withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'live')

      await expect(
        database.getActorFromUsername({
          username: 'LIVE',
          domain: TEST_DOMAIN
        })
      ).resolves.toMatchObject({ username: 'live', domain: TEST_DOMAIN })
    }))

  it('getActorFromUsername returns null for a replaced handle whose actor was deleted', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'departed')
      await database.deleteActorData({ actorId })

      await expect(
        database.getActorFromUsername({
          username: 'departed',
          domain: TEST_DOMAIN
        })
      ).resolves.toBeNull()
    }))

  it('deletion retires the current row instead of deleting it and blocks re-registration', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createLocalAccount(database, 'doomed')
      await rename(database, actorId, 'afterlife')
      await expect(database.getActorHandles({ actorId })).resolves.toHaveLength(
        2
      )

      await database.deleteActorData({ actorId })

      const rows = await database.getActorHandles({ actorId })
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.replacedAt !== null)).toBe(true)
      await expect(
        database.getCurrentActorHandle({ actorId })
      ).resolves.toBeNull()

      // The handle can never be re-registered on this domain.
      await expect(createLocalAccount(database, 'doomed')).rejects.toThrow()
      await expect(createLocalAccount(database, 'afterlife')).rejects.toThrow()
      await expect(
        database.isUsernameExists({ username: 'DOOMED', domain: TEST_DOMAIN })
      ).resolves.toBe(true)
    }))

  describe('recordActorHandleRename', () => {
    it('renames in place: actors row updated, ledger swapped, id unchanged, search re-indexed', () =>
      withFreshDatabase(async (database, db) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')

        const result = await rename(database, actorId, 'renamed', now)
        if (!result.ok) throw new Error(`expected ok, got ${result.status}`)

        expect(result.previous).toEqual({
          username: 'mover',
          domain: TEST_DOMAIN
        })
        expect(result.current).toEqual({
          username: 'renamed',
          domain: TEST_DOMAIN
        })
        expect(result.handleId).toBeTruthy()

        await expect(
          database.getActorFromId({ id: actorId })
        ).resolves.toMatchObject({
          id: actorId,
          username: 'renamed',
          domain: TEST_DOMAIN
        })

        const handles = await database.getActorHandles({ actorId })
        expect(handles).toHaveLength(2)
        expect(handles[0]).toMatchObject({
          username: 'renamed',
          replacedAt: null
        })
        expect(handles[1]).toMatchObject({
          username: 'mover',
          replacedAt: now.getTime()
        })
        // handleId is the row that just became current.
        expect(handles[0].id).toBe(result.handleId)

        const document = await db
          .selectFrom('search_documents')
          .selectAll()
          .where('entityType', '=', 'account')
          .where('entityId', '=', actorId)
          .executeTakeFirst()
        expect(document?.documentText).toContain('renamed')
        expect(document?.documentText).not.toContain('mover')
      }))

    it('refuses an unknown or remote actor with not_found', () =>
      withFreshDatabase(async (database) => {
        const now = new Date('2026-01-01T00:00:00.000Z')

        await expect(
          rename(
            database,
            `https://${TEST_DOMAIN}/users/nobody`,
            'whatever',
            now,
            0
          )
        ).resolves.toEqual({ ok: false, status: 'not_found' })

        const remoteId = await createRemoteActor(database, 'remote-actor')
        await expect(
          rename(database, remoteId, 'whatever', now, 0)
        ).resolves.toEqual({ ok: false, status: 'not_found' })
      }))

    it('refuses a moved actor with moved', () =>
      withFreshDatabase(async (database, db) => {
        const actorId = await createLocalAccount(database, 'gone')
        await db
          .updateTable('actors')
          .set({
            settings: JSON.stringify({
              movedTo: 'https://elsewhere.test/users/target'
            })
          })
          .where('id', '=', actorId)
          .execute()

        await expect(
          rename(database, actorId, 'renamed', new Date(), 0)
        ).resolves.toEqual({ ok: false, status: 'moved' })
      }))

    it('refuses a deleting or suspended actor with unavailable', () =>
      withFreshDatabase(async (database, db) => {
        const deletingId = await createLocalAccount(database, 'deleting-one')
        await db
          .updateTable('actors')
          .set({ deletionStatus: 'deleting' })
          .where('id', '=', deletingId)
          .execute()
        await expect(
          rename(database, deletingId, 'renamed', new Date(), 0)
        ).resolves.toEqual({ ok: false, status: 'unavailable' })

        const suspendedId = await createLocalAccount(database, 'suspended-one')
        await db
          .updateTable('actors')
          .set({ suspendedAt: new Date() })
          .where('id', '=', suspendedId)
          .execute()
        await expect(
          rename(database, suspendedId, 'renamed', new Date(), 0)
        ).resolves.toEqual({ ok: false, status: 'unavailable' })
      }))

    it('refuses the same handle, in any casing, with unchanged', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')

        await expect(
          rename(database, actorId, 'mover', now, 0)
        ).resolves.toEqual({ ok: false, status: 'unchanged' })
        await expect(
          rename(database, actorId, 'MOVER', now, 0)
        ).resolves.toEqual({ ok: false, status: 'unchanged' })
      }))

    it('refuses an actor inside the cooldown with cooldownUntil', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')
        const cooldownMs = 30 * 24 * 60 * 60 * 1000
        await rename(database, actorId, 'first-rename', now)

        await expect(
          rename(
            database,
            actorId,
            'second-rename',
            new Date(now.getTime() + 1000)
          )
        ).resolves.toEqual({
          ok: false,
          status: 'cooldown',
          cooldownUntil: now.getTime() + cooldownMs
        })

        // After the cooldown the rename goes through.
        await expect(
          rename(
            database,
            actorId,
            'second-rename',
            new Date(now.getTime() + cooldownMs)
          )
        ).resolves.toMatchObject({ ok: true })
      }))

    it('refuses a target another actor holds, in any casing, with taken', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        await createLocalAccount(database, 'occupied')
        const now = new Date('2026-01-01T00:00:00.000Z')

        await expect(
          rename(database, actorId, 'occupied', now, 0)
        ).resolves.toEqual({ ok: false, status: 'taken' })
        await expect(
          rename(database, actorId, 'OCCUPIED', now, 0)
        ).resolves.toEqual({ ok: false, status: 'taken' })
      }))

    it('refuses a target another actor retired with taken', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        const otherId = await createLocalAccount(database, 'quitter')
        await rename(database, otherId, 'quitter-new', new Date(), 0)

        await expect(
          rename(database, actorId, 'quitter', new Date(), 0)
        ).resolves.toEqual({ ok: false, status: 'taken' })
      }))

    it('refuses a backfill case twin with cannot_rename', () =>
      withFreshDatabase(async (database, db) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')
        // The backfill twin shape, written by hand: another actor's ledger
        // row holds a case twin of THIS actor's handle, and this actor has no
        // current row of its own.
        const twinActorId = `https://${TEST_DOMAIN}/users/twin-owner`
        await db
          .insertInto('actors')
          .values({
            id: twinActorId,
            username: 'MOVER',
            domain: TEST_DOMAIN,
            accountId: null,
            publicKey: 'public-key',
            createdAt: now,
            updatedAt: now
          })
          .execute()
        // This actor loses its current row first: the twin row occupies the
        // folded handle only once that row is gone.
        await db
          .deleteFrom('actor_handles')
          .where('actorId', '=', actorId)
          .execute()
        await db
          .insertInto('actor_handles')
          .values({
            id: 'twin-row',
            actorId: twinActorId,
            username: 'MOVER',
            domain: TEST_DOMAIN,
            createdAt: now,
            replacedAt: null
          })
          .execute()

        await expect(
          rename(database, actorId, 'something-else', now, 0)
        ).resolves.toEqual({ ok: false, status: 'cannot_rename' })
      }))

    it('renames back onto its own retired row by reviving it, keeping the row count', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')
        await rename(database, actorId, 'renamed', now)
        const afterFirst = await database.getActorHandles({ actorId })
        expect(afterFirst).toHaveLength(2)
        const retiredRowId = afterFirst.find(
          (row) => row.username === 'mover'
        )!.id

        const back = await rename(
          database,
          actorId,
          'mover',
          new Date(now.getTime() + 1000),
          0
        )
        if (!back.ok) throw new Error(`expected ok, got ${back.status}`)
        expect(back.current).toEqual({
          username: 'mover',
          domain: TEST_DOMAIN
        })
        // The revived row IS the handle row: no second row was inserted.
        expect(back.handleId).toBe(retiredRowId)
        const afterBack = await database.getActorHandles({ actorId })
        expect(afterBack).toHaveLength(2)
        expect(afterBack.find((row) => row.id === retiredRowId)).toMatchObject({
          username: 'mover',
          replacedAt: null
        })
        expect(
          afterBack.find((row) => row.username === 'renamed')?.replacedAt
        ).toBeTruthy()

        await expect(
          database.getActorFromId({ id: actorId })
        ).resolves.toMatchObject({ username: 'mover' })
      }))

    it('lazily mints the current row for an actor the ledger never covered, carrying the actor createdAt', () =>
      withFreshDatabase(async (database, db) => {
        const actorId = await createLocalAccount(database, 'mover')
        const now = new Date('2026-01-01T00:00:00.000Z')
        await db
          .deleteFrom('actor_handles')
          .where('actorId', '=', actorId)
          .execute()
        const actor = await database.getActorFromId({ id: actorId })

        await expect(
          rename(database, actorId, 'renamed', now, 0)
        ).resolves.toMatchObject({ ok: true })

        const handles = await database.getActorHandles({ actorId })
        expect(handles).toHaveLength(2)
        expect(handles[1]).toMatchObject({
          username: 'mover',
          replacedAt: now.getTime(),
          createdAt: actor!.createdAt
        })
      }))

    it('never changes actors.id', () =>
      withFreshDatabase(async (database) => {
        const actorId = await createLocalAccount(database, 'mover')
        await rename(database, actorId, 'renamed', new Date(), 0)

        // actors.id IS the actorId handed in: it must survive the rename.
        await expect(
          database.getActorFromId({ id: actorId })
        ).resolves.toMatchObject({ id: actorId, username: 'renamed' })
      }))
  })
})
