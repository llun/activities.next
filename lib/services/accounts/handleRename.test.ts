import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  getHandleState,
  resolveAllowedDomain
} from '@/lib/services/accounts/handleRename'
import { MOVE_COOLDOWN_MS } from '@/lib/services/accounts/migration/outgoingMove'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

const DAY = 24 * 60 * 60 * 1000

describe('handleRename service', () => {
  const testDb = createTestDatabase()
  let database: Database
  let db: Db

  const createLocalAccount = async (username: string) => {
    const accountId = await database.createAccount({
      email: `${username}-${crypto.randomUUID()}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return { accountId, actor: actors[0] }
  }

  beforeAll(async () => {
    await testDb.prepare()
    database = testDb.database
    db = testDb.db
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('getHandleState', () => {
    it('returns the shape for an actor that never renamed', async () => {
      const { actor } = await createLocalAccount('fresh')

      const state = await getHandleState({
        database,
        actor,
        currentHost: TEST_DOMAIN
      })
      expect(state.actorId).toBe(actor.id)
      expect(state.username).toBe('fresh')
      expect(state.domain).toBe(TEST_DOMAIN)
      expect(state.acct).toBe(`fresh@${TEST_DOMAIN}`)
      // The ledger holds the actor's current row from the mint.
      expect(state.history).toEqual([
        expect.objectContaining({ username: 'fresh', replacedAt: null })
      ])
      expect(state.cooldownUntil).toBeNull()
      expect(state.domains).toEqual([TEST_DOMAIN])
    })

    it('returns the history and the running cooldown of a renamed actor', async () => {
      const now = Date.now()
      const { actor } = await createLocalAccount('historical')
      const renamed = await database.recordActorHandleRename({
        actorId: actor.id,
        username: 'renamed',
        domain: TEST_DOMAIN,
        now: new Date(now),
        cooldownMs: MOVE_COOLDOWN_MS
      })
      expect(renamed.ok).toBe(true)
      const updated = await database.getActorFromId({ id: actor.id })

      const state = await getHandleState({
        database,
        actor: updated!,
        currentHost: TEST_DOMAIN
      })
      expect(state.username).toBe('renamed')
      expect(state.history).toHaveLength(2)
      expect(state.history[0]).toMatchObject({
        username: 'renamed',
        replacedAt: null
      })
      expect(state.history[1]).toMatchObject({ username: 'historical' })
      expect(state.cooldownUntil).toBe(
        new Date(now + MOVE_COOLDOWN_MS).toISOString()
      )
    })

    it('omits the cooldown once it elapsed', async () => {
      const { actor } = await createLocalAccount('elapsed')
      await database.recordActorHandleRename({
        actorId: actor.id,
        username: 'renamed-too',
        domain: TEST_DOMAIN,
        now: new Date(Date.now() - 31 * DAY),
        cooldownMs: MOVE_COOLDOWN_MS
      })
      const updated = await database.getActorFromId({ id: actor.id })

      const state = await getHandleState({
        database,
        actor: updated!,
        currentHost: TEST_DOMAIN
      })
      expect(state.cooldownUntil).toBeNull()
    })

    it('always lists the current domain, even one the account filter narrows', async () => {
      const { actor } = await createLocalAccount('elsewhere-domain')
      const state = await getHandleState({
        database,
        actor: { ...actor, domain: 'unlisted.example' },
        currentHost: TEST_DOMAIN
      })
      expect(state.domains).toContain('unlisted.example')
    })
  })

  describe('resolveAllowedDomain', () => {
    it('resolves the current domain when none is requested', async () => {
      const { actor } = await createLocalAccount('default-domain')
      await expect(
        resolveAllowedDomain(database, actor, undefined, TEST_DOMAIN)
      ).resolves.toBe(TEST_DOMAIN)
    })

    it('refuses a domain outside the served rules', async () => {
      const { actor } = await createLocalAccount('foreign-domain')
      await expect(
        resolveAllowedDomain(database, actor, 'elsewhere.example', TEST_DOMAIN)
      ).resolves.toBeNull()
    })

    it('normalises casing and a trailing dot', async () => {
      const { actor } = await createLocalAccount('case-domain')
      await expect(
        resolveAllowedDomain(
          database,
          actor,
          TEST_DOMAIN.toUpperCase(),
          TEST_DOMAIN
        )
      ).resolves.toBe(TEST_DOMAIN)
    })

    // A username-only rename (or one that names the current domain again)
    // must not go through the domain pipeline: the handle already lives
    // there, so a later-narrowed allowActorDomains or sign-up filter must
    // not strand it with 400 `Domain is not allowed`.
    it('skips the domain filter for a username-only rename onto a domain the rules refuse', async () => {
      const { actor } = await createLocalAccount('stranded-domain')
      const stranded = { ...actor, domain: 'unlisted.example' }

      await expect(
        resolveAllowedDomain(database, stranded, undefined, TEST_DOMAIN)
      ).resolves.toBe('unlisted.example')
    })

    it('skips the domain filter for the current domain in any casing', async () => {
      const { actor } = await createLocalAccount('stranded-cased')
      const stranded = { ...actor, domain: 'unlisted.example' }

      await expect(
        resolveAllowedDomain(
          database,
          stranded,
          'UNLISTED.EXAMPLE',
          TEST_DOMAIN
        )
      ).resolves.toBe('unlisted.example')
    })

    it('still refuses a domain change onto a domain the rules refuse', async () => {
      const { actor } = await createLocalAccount('stranded-change')
      const stranded = { ...actor, domain: 'unlisted.example' }

      await expect(
        resolveAllowedDomain(
          database,
          stranded,
          'elsewhere.example',
          TEST_DOMAIN
        )
      ).resolves.toBeNull()
    })
  })

  it('leaves the status rows alone (no url rewrite here)', async () => {
    const { actor } = await createLocalAccount('no-status-touch')
    const url = `https://${TEST_DOMAIN}/@no-status-touch/1`
    await db
      .insertInto('statuses')
      .values({
        id: `${actor.id}/statuses/one`,
        actorId: actor.id,
        url,
        urlHash: 'hash',
        type: 'Note',
        content: null
      })
      .execute()
    await database.recordActorHandleRename({
      actorId: actor.id,
      username: 'no-status-touch-new',
      domain: TEST_DOMAIN,
      now: new Date(),
      cooldownMs: MOVE_COOLDOWN_MS
    })

    const row = await db
      .selectFrom('statuses')
      .select(['url', 'urlHash'])
      .where('id', '=', `${actor.id}/statuses/one`)
      .executeTakeFirstOrThrow()
    expect(row).toEqual({ url, urlHash: 'hash' })
  })
})
