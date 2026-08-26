import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

// Writes an actor row with the username spelled EXACTLY as given. The local
// mint paths normalize, so this is the only way to stand up the mixed-case
// rows an instance may already hold from before they did — and it is also how
// a remote actor arrives, since a remote server chooses its own casing.
const createActorWithRawUsername = (
  database: Database,
  username: string,
  domain = TEST_DOMAIN,
  createdAt = Date.now()
) =>
  database.createActor({
    actorId: `https://${domain}/users/${username}`,
    username,
    domain,
    followersUrl: `https://${domain}/users/${username}/followers`,
    inboxUrl: `https://${domain}/users/${username}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    publicKey: 'publicKey',
    createdAt
  })

describe('case-insensitive actor username lookup', () => {
  describe('getActorFromUsername', () => {
    it.each([
      { description: 'the stored spelling', lookup: 'MixedCase' },
      { description: 'all lowercase', lookup: 'mixedcase' },
      { description: 'all uppercase', lookup: 'MIXEDCASE' },
      { description: 'a different mixed case', lookup: 'mIXEDcASE' }
    ])('finds an actor stored as MixedCase by $description', ({ lookup }) =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        const actor = await database.getActorFromUsername({
          username: lookup,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/MixedCase`,
          username: 'MixedCase',
          domain: TEST_DOMAIN
        })
      })
    )

    it('still refuses a username that is genuinely absent', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        expect(
          await database.getActorFromUsername({
            username: 'someoneelse',
            domain: TEST_DOMAIN
          })
        ).toBeNull()
      }))

    it('does not fold across domains', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        expect(
          await database.getActorFromUsername({
            username: 'mixedcase',
            domain: 'somewhere.else.test'
          })
        ).toBeNull()
      }))

    // The reason findActorRowByUsername tries an exact match BEFORE folding.
    // Local actors minted before usernames were normalized keep their casing
    // (their ActivityPub ids are already federated), so an instance can hold
    // both spellings — and `/@Alice` must not start resolving to `alice`.
    it('prefers the exactly-cased row when both spellings exist', () =>
      withFreshDatabase(async (database) => {
        // `alice` is created FIRST so that a fold-only lookup, which orders by
        // createdAt, would return it and fail this test.
        await createActorWithRawUsername(database, 'alice', TEST_DOMAIN, 1000)
        await createActorWithRawUsername(database, 'Alice', TEST_DOMAIN, 2000)

        const upper = await database.getActorFromUsername({
          username: 'Alice',
          domain: TEST_DOMAIN
        })
        const lower = await database.getActorFromUsername({
          username: 'alice',
          domain: TEST_DOMAIN
        })

        expect(upper?.id).toBe(`https://${TEST_DOMAIN}/users/Alice`)
        expect(lower?.id).toBe(`https://${TEST_DOMAIN}/users/alice`)
      }))

    it('resolves an unmatched casing to the row that claimed the name first', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'Alice', TEST_DOMAIN, 1000)
        await createActorWithRawUsername(database, 'ALICE', TEST_DOMAIN, 2000)

        const actor = await database.getActorFromUsername({
          username: 'aLiCe',
          domain: TEST_DOMAIN
        })

        expect(actor?.id).toBe(`https://${TEST_DOMAIN}/users/Alice`)
      }))

    // SQL `lower()` and JS `toLowerCase()` do not fold the same alphabet:
    // SQLite's builtin is ASCII-only while `toLowerCase()` is Unicode-aware, so
    // a single folded query would compare `Фёдор` against `фёдор` and miss a
    // row that resolves today. Trying the exact match first is what keeps this
    // passing on both backends.
    it('finds a non-ASCII username by its exact spelling', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'Фёдор')

        const actor = await database.getActorFromUsername({
          username: 'Фёдор',
          domain: TEST_DOMAIN
        })

        expect(actor?.username).toBe('Фёдор')
      }))
  })

  describe('isUsernameExists', () => {
    it.each([
      { description: 'the stored spelling', lookup: 'MixedCase' },
      { description: 'all lowercase', lookup: 'mixedcase' },
      { description: 'all uppercase', lookup: 'MIXEDCASE' }
    ])('reports a name taken when asked with $description', ({ lookup }) =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        expect(
          await database.isUsernameExists({
            username: lookup,
            domain: TEST_DOMAIN
          })
        ).toBe(true)
      })
    )

    it('reports a free name as free', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        expect(
          await database.isUsernameExists({
            username: 'nobody',
            domain: TEST_DOMAIN
          })
        ).toBe(false)
      }))

    it('does not report a name taken on a different domain', () =>
      withFreshDatabase(async (database) => {
        await createActorWithRawUsername(database, 'MixedCase')

        expect(
          await database.isUsernameExists({
            username: 'mixedcase',
            domain: 'somewhere.else.test'
          })
        ).toBe(false)
      }))
  })

  // The mint paths, where normalization rather than folding is what runs. The
  // username is interpolated into the actor id, so the assertion that matters
  // is that BOTH come out lowercased — a normalized column beside a mixed-case
  // id would break every id-derived lookup.
  describe('minting a local actor', () => {
    it('stores a lowercase username and id for createAccount', () =>
      withFreshDatabase(async (database) => {
        await database.createAccount({
          email: 'mixed@test.com',
          username: 'MixedCase',
          domain: TEST_DOMAIN,
          passwordHash: TEST_PASSWORD_HASH,
          privateKey: 'privateKey',
          publicKey: 'publicKey'
        })

        const actor = await database.getActorFromUsername({
          username: 'MixedCase',
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/mixedcase`,
          username: 'mixedcase'
        })
      }))

    it('stores a lowercase username and id for createActorForAccount', () =>
      withFreshDatabase(async (database) => {
        const accountId = await database.createAccount({
          email: 'owner@test.com',
          username: 'owner',
          domain: TEST_DOMAIN,
          passwordHash: TEST_PASSWORD_HASH,
          privateKey: 'privateKey',
          publicKey: 'publicKey'
        })

        const actorId = await database.createActorForAccount({
          accountId,
          username: 'SecondActor',
          domain: TEST_DOMAIN,
          privateKey: 'privateKey',
          publicKey: 'publicKey'
        })

        expect(actorId).toBe(`https://${TEST_DOMAIN}/users/secondactor`)
        expect(
          await database.getActorFromUsername({
            username: 'SECONDACTOR',
            domain: TEST_DOMAIN
          })
        ).toMatchObject({ id: actorId, username: 'secondactor' })
      }))

    it('refuses a second actor whose name differs only by case', () =>
      withFreshDatabase(async (database) => {
        await database.createAccount({
          email: 'first@test.com',
          username: 'alice',
          domain: TEST_DOMAIN,
          passwordHash: TEST_PASSWORD_HASH,
          privateKey: 'privateKey',
          publicKey: 'publicKey'
        })

        expect(
          await database.isUsernameExists({
            username: 'Alice',
            domain: TEST_DOMAIN
          })
        ).toBe(true)
      }))
  })
})
