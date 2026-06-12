import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { type SQLActorDatabase } from '@/lib/database/sql/actor'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  getFederationSigningActorId,
  getFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import {
  EXTERNAL_ACTORS,
  TEST_DOMAIN,
  TEST_DOMAIN_2,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME3
} from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { type StatusPoll } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

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

const createSigningAccount = async (
  database: Database,
  username: string,
  {
    domain = TEST_DOMAIN,
    privateKey = `privateKey-${username}`,
    publicKey = `publicKey-${username}`
  }: {
    domain?: string
    privateKey?: string
    publicKey?: string
  } = {}
) =>
  database.createAccount({
    email: `${username}@${domain}`,
    username,
    passwordHash: TEST_PASSWORD_HASH,
    domain,
    privateKey,
    publicKey
  })

describe('ActorDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await database.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME3,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey1',
        publicKey: 'publicKey1'
      })

      await database.createActor({
        actorId: EXTERNAL_ACTORS[0].id,
        username: EXTERNAL_ACTORS[0].username,
        domain: EXTERNAL_ACTORS[0].domain,
        followersUrl: EXTERNAL_ACTORS[0].followers_url,
        inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
    })

    describe('getActor', () => {
      it('falls back to Person for unknown persisted actor types', () => {
        const actor = (database as SQLActorDatabase).getActor(
          {
            id: `https://${TEST_DOMAIN}/users/unknown-type`,
            type: 'UnknownType' as never,
            username: 'unknown-type',
            domain: TEST_DOMAIN,
            accountId: null,
            publicKey: 'public-key',
            privateKey: '',
            settings: JSON.stringify({
              followersUrl: `https://${TEST_DOMAIN}/users/unknown-type/followers`,
              inboxUrl: `https://${TEST_DOMAIN}/users/unknown-type/inbox`,
              sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`
            }),
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          0,
          0,
          0,
          0
        )

        expect(actor.type).toBe('Person')
      })
    })

    describe('deprecated actor', () => {
      it('returns actor from id', async () => {
        const id = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        const actor = await database.getActorFromId({
          id
        })

        expect(actor).toMatchObject({
          id,
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `${id}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })

      it('returns actor from username', async () => {
        const actor = await database.getActorFromUsername({
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })

      it('returns actor from email', async () => {
        const actor = await database.getActorFromEmail({
          email: TEST_EMAIL
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}/followers`,
          publicKey: expect.toBeString(),
          privateKey: expect.toBeString()
        })
      })
    })

    describe('getFederationSigningActor', () => {
      it('creates a dedicated headless instance actor with a private key', async () => {
        const actor = await database.getFederationSigningActor()

        expect(actor).toMatchObject({
          id: getFederationSigningActorId(TEST_DOMAIN),
          type: FEDERATION_SIGNING_ACTOR_TYPE,
          username: FEDERATION_SIGNING_ACTOR_USERNAME,
          domain: TEST_DOMAIN,
          privateKey: expect.toBeString(),
          publicKey: expect.toBeString()
        })
        expect(actor?.account).toBeUndefined()
      })

      it('returns one signer for concurrent first-run bootstrap calls', async () => {
        await withFreshDatabase(async (database) => {
          const [first, second] = await Promise.all([
            database.getFederationSigningActor(),
            database.getFederationSigningActor()
          ])

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(second?.id).toBe(first?.id)
          expect(second?.privateKey).toBe(first?.privateKey)
        })
      })

      it('creates the headless actor when no user actors exist', async () => {
        await withFreshDatabase(async (database) => {
          await database.createActor({
            actorId: EXTERNAL_ACTORS[0].id,
            username: EXTERNAL_ACTORS[0].username,
            domain: EXTERNAL_ACTORS[0].domain,
            followersUrl: EXTERNAL_ACTORS[0].followers_url,
            inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
            sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
            publicKey: 'publicKey',
            createdAt: Date.now()
          })

          await createSigningAccount(database, 'empty-key-signer', {
            privateKey: ''
          })
          await createSigningAccount(database, 'wrong-domain-signer', {
            domain: TEST_DOMAIN_2
          })

          const actor = await database.getFederationSigningActor()
          expect(actor).toMatchObject({
            id: getFederationSigningActorId(TEST_DOMAIN),
            type: FEDERATION_SIGNING_ACTOR_TYPE
          })
          expect(actor?.account).toBeUndefined()
        })
      })

      it('uses an alternate headless actor instead of a real user actor when the reserved id is unavailable', async () => {
        await withFreshDatabase(async (database) => {
          const username = 'deleting-signer'
          await createSigningAccount(database, username)

          await database.createActor({
            actorId: getFederationSigningActorId(TEST_DOMAIN),
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: FEDERATION_SIGNING_ACTOR_USERNAME,
            domain: TEST_DOMAIN,
            followersUrl: `${getFederationSigningActorId(TEST_DOMAIN)}/followers`,
            inboxUrl: `${getFederationSigningActorId(TEST_DOMAIN)}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: '',
            createdAt: Date.now()
          })

          const actor = await database.getFederationSigningActor()
          const fallbackUsername = getFederationSigningActorUsername(1)

          expect(actor).toMatchObject({
            id: getFederationSigningActorId(TEST_DOMAIN, fallbackUsername),
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: fallbackUsername,
            domain: TEST_DOMAIN,
            privateKey: expect.toBeString()
          })
          expect(actor?.account).toBeUndefined()
        })
      })

      it('does not reuse arbitrary service actors as the federation signer', async () => {
        await withFreshDatabase(async (database) => {
          await database.createActor({
            actorId: `https://${TEST_DOMAIN}/users/not-the-instance`,
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: 'not-the-instance',
            domain: TEST_DOMAIN,
            followersUrl: `https://${TEST_DOMAIN}/users/not-the-instance/followers`,
            inboxUrl: `https://${TEST_DOMAIN}/users/not-the-instance/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            privateKey: 'private-key',
            createdAt: Date.now()
          })

          const actor = await database.getFederationSigningActor()

          expect(actor?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(actor?.username).toBe(FEDERATION_SIGNING_ACTOR_USERNAME)
        })
      })

      it('deterministically returns the reserved headless actor', async () => {
        await withFreshDatabase(async (database) => {
          await createSigningAccount(database, 'older-signer')
          await new Promise((resolve) => setTimeout(resolve, 5))
          await createSigningAccount(database, 'newer-signer')

          const first = await database.getFederationSigningActor()
          const second = await database.getFederationSigningActor()

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(second?.id).toBe(first?.id)
          expect(second?.privateKey).toBe(first?.privateKey)
        })
      })
    })

    describe('mastodon actor', () => {
      it('returns mastodon actor from id', async () => {
        const actor = await database.getMastodonActorFromId({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: TEST_USERNAME3,
          url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          display_name: '',
          note: '',
          avatar: '',
          avatar_static: '',
          header: '',
          header_static: '',
          locked: true,
          fields: [],
          emojis: [],
          bot: false,
          group: false,
          discoverable: true,
          noindex: false,
          created_at: expect.toBeString(),
          last_status_at: null,
          statuses_count: 0,
          followers_count: 0,
          following_count: 0
        })
      })

      it('returns mastodon actors from ids in request order', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const username = `bulk-${suffix}`
          const localActorId = `https://${TEST_DOMAIN}/users/${username}`
          const remoteActorId = `https://remote-${suffix}.example/users/alice`
          const statusId = `${localActorId}/statuses/1`

          await database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${suffix}`,
            publicKey: `publicKey-${suffix}`
          })
          await database.createActor({
            actorId: remoteActorId,
            username: 'alice',
            domain: `remote-${suffix}.example`,
            followersUrl: `${remoteActorId}/followers`,
            inboxUrl: `${remoteActorId}/inbox`,
            sharedInboxUrl: `${remoteActorId}/inbox`,
            publicKey: `remotePublicKey-${suffix}`,
            createdAt: Date.now()
          })
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Bulk account lookup test'
          })
          await database.createFollow({
            actorId: remoteActorId,
            targetActorId: localActorId,
            inbox: `${remoteActorId}/inbox`,
            sharedInbox: `${remoteActorId}/inbox`,
            status: FollowStatus.enum.Accepted
          })
          await database.createFollow({
            actorId: localActorId,
            targetActorId: remoteActorId,
            inbox: `${localActorId}/inbox`,
            sharedInbox: `https://${TEST_DOMAIN}/inbox`,
            status: FollowStatus.enum.Accepted
          })

          const actors = await database.getMastodonActorsFromIds({
            ids: [
              remoteActorId,
              'https://missing.example/users/not-found',
              localActorId,
              remoteActorId
            ]
          })

          expect(actors.map((actor) => actor.url)).toEqual([
            remoteActorId,
            localActorId,
            remoteActorId
          ])
          expect(actors[1]).toMatchObject({
            url: localActorId,
            last_status_at: expect.toBeString(),
            statuses_count: 1,
            followers_count: 1,
            following_count: 1
          })
        })
      })

      it('returns the latest actor status timestamp from a grouped lookup', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const username = `latest-status-${suffix}`
          const actorId = `https://${TEST_DOMAIN}/users/${username}`
          const olderCreatedAt = Date.parse('2026-05-16T00:00:00.000Z')
          const newerCreatedAt = Date.parse('2026-05-17T00:00:00.000Z')

          await createSigningAccount(database, username)
          await database.createNote({
            id: `${actorId}/statuses/older`,
            url: `${actorId}/statuses/older`,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Older status',
            createdAt: olderCreatedAt
          })
          await database.createNote({
            id: `${actorId}/statuses/newer`,
            url: `${actorId}/statuses/newer`,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Newer status',
            createdAt: newerCreatedAt
          })

          const [mastodonActor] = await database.getMastodonActorsFromIds({
            ids: [actorId]
          })

          expect(mastodonActor.last_status_at).toBe(
            getISOTimeUTC(newerCreatedAt, true)
          )
        })
      })

      it('returns mastodon actor from username', async () => {
        const actor = await database.getMastodonActorFromUsername({
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: TEST_USERNAME3,
          url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          display_name: '',
          note: '',
          avatar: '',
          avatar_static: '',
          header: '',
          header_static: '',
          locked: true,
          fields: [],
          emojis: [],
          bot: false,
          group: false,
          discoverable: true,
          noindex: false,
          created_at: expect.toBeString(),
          last_status_at: null,
          statuses_count: 0,
          followers_count: 0,
          following_count: 0
        })
      })

      it('returns mastodon actor from email', async () => {
        const actor = await database.getMastodonActorFromEmail({
          email: TEST_EMAIL
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: TEST_USERNAME3,
          url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          display_name: '',
          note: '',
          avatar: '',
          avatar_static: '',
          header: '',
          header_static: '',
          locked: true,
          fields: [],
          emojis: [],
          bot: false,
          group: false,
          discoverable: true,
          noindex: false,
          created_at: expect.toBeString(),
          last_status_at: null,
          statuses_count: 0,
          followers_count: 0,
          following_count: 0
        })
      })

      it('returns local headless signer as undiscoverable bot account', async () => {
        await withFreshDatabase(async (database) => {
          const signingActor = await database.getFederationSigningActor()
          expect(signingActor).toBeTruthy()

          const actor = await database.getMastodonActorFromId({
            id: signingActor!.id
          })

          expect(actor).toMatchObject({
            username: FEDERATION_SIGNING_ACTOR_USERNAME,
            bot: true,
            group: false,
            discoverable: false,
            noindex: true,
            statuses_count: 0,
            followers_count: 0,
            following_count: 0
          })
        })
      })

      it('maps remote ActivityPub actor types to Mastodon fields', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const serviceActorId = `https://remote-${suffix}.example/users/service`
          const groupActorId = `https://remote-${suffix}.example/users/group`

          await database.createActor({
            actorId: serviceActorId,
            type: 'Service',
            username: 'service',
            domain: `remote-${suffix}.example`,
            followersUrl: `${serviceActorId}/followers`,
            inboxUrl: `${serviceActorId}/inbox`,
            sharedInboxUrl: `${serviceActorId}/inbox`,
            publicKey: 'servicePublicKey',
            createdAt: Date.now()
          })
          await database.createActor({
            actorId: groupActorId,
            type: 'Group',
            username: 'group',
            domain: `remote-${suffix}.example`,
            followersUrl: `${groupActorId}/followers`,
            inboxUrl: `${groupActorId}/inbox`,
            sharedInboxUrl: `${groupActorId}/inbox`,
            publicKey: 'groupPublicKey',
            createdAt: Date.now()
          })

          const serviceActor = await database.getMastodonActorFromId({
            id: serviceActorId
          })
          const groupActor = await database.getMastodonActorFromId({
            id: groupActorId
          })

          expect(serviceActor).toMatchObject({
            acct: `service@remote-${suffix}.example`,
            bot: true,
            group: false,
            discoverable: true,
            noindex: false
          })
          expect(groupActor).toMatchObject({
            acct: `group@remote-${suffix}.example`,
            bot: false,
            group: true,
            discoverable: true,
            noindex: false
          })
        })
      })

      it('qualifies the acct of a hosted actor on a non-configured domain', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const username = `multi-${suffix}`
          await database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${suffix}`,
            publicKey: `publicKey-${suffix}`
          })
          const account = await database.getAccountFromEmail({
            email: `${username}@${TEST_DOMAIN}`
          })
          const aliasActorId = await database.createActorForAccount({
            accountId: account!.id,
            username,
            domain: TEST_DOMAIN_2,
            privateKey: `aliasPriv-${suffix}`,
            publicKey: `aliasPub-${suffix}`
          })

          const homeActor = await database.getMastodonActorFromUsername({
            username,
            domain: TEST_DOMAIN
          })
          const aliasActor = await database.getMastodonActorFromId({
            id: aliasActorId
          })

          // The actor on the configured host keeps a bare acct...
          expect(homeActor?.acct).toBe(username)
          // ...but the same account's actor on a different domain must be
          // qualified, so a Mastodon client treats them as distinct accounts
          // instead of collapsing them into one (blank) switcher row.
          expect(aliasActor?.acct).toBe(`${username}@${TEST_DOMAIN_2}`)
        })
      })

      it('treats a configured-host actor as local case-insensitively', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const username = `case-${suffix}`
          await database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${suffix}`,
            publicKey: `publicKey-${suffix}`
          })
          const account = await database.getAccountFromEmail({
            email: `${username}@${TEST_DOMAIN}`
          })
          // Same domain as the configured host but in a different letter case.
          const upperActorId = await database.createActorForAccount({
            accountId: account!.id,
            username,
            domain: TEST_DOMAIN.toUpperCase(),
            privateKey: `upperPriv-${suffix}`,
            publicKey: `upperPub-${suffix}`
          })

          const actor = await database.getMastodonActorFromId({
            id: upperActorId
          })
          // Domains are case-insensitive, so this is still a local actor → bare.
          expect(actor?.acct).toBe(username)
        })
      })

      it('lowercases the domain in a qualified acct', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const username = `mixed-${suffix}`
          const mixedDomain = `Alias-${suffix}.Example`
          await database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${suffix}`,
            publicKey: `publicKey-${suffix}`
          })
          const account = await database.getAccountFromEmail({
            email: `${username}@${TEST_DOMAIN}`
          })
          const actorId = await database.createActorForAccount({
            accountId: account!.id,
            username,
            domain: mixedDomain,
            privateKey: `mixedPriv-${suffix}`,
            publicKey: `mixedPub-${suffix}`
          })

          const actor = await database.getMastodonActorFromId({ id: actorId })
          // Non-configured domain → qualified, with the domain canonicalized.
          expect(actor?.acct).toBe(`${username}@${mixedDomain.toLowerCase()}`)
        })
      })
    })

    describe('external actors', () => {
      it('creates actor without account in the database and returns deprecated actor model', async () => {
        const actor = await database.getActorFromId({
          id: EXTERNAL_ACTORS[0].id
        })
        expect(actor).toBeDefined()
        expect(actor?.username).toEqual(EXTERNAL_ACTORS[0].username)
        expect(actor?.domain).toEqual(EXTERNAL_ACTORS[0].domain)
        expect(actor?.followersUrl).toEqual(EXTERNAL_ACTORS[0].followers_url)
        expect(actor?.inboxUrl).toEqual(EXTERNAL_ACTORS[0].inbox_url)
        expect(actor?.sharedInboxUrl).toEqual(EXTERNAL_ACTORS[0].inbox_url)
        expect(actor?.publicKey).toEqual('publicKey')
      })

      it('creates actor without account in the database and returns mastodon actor model', async () => {
        const currentTime = Date.now()
        const actor = await database.createMastodonActor({
          actorId: EXTERNAL_ACTORS[1].id,
          username: EXTERNAL_ACTORS[1].username,
          name: EXTERNAL_ACTORS[1].name,
          domain: EXTERNAL_ACTORS[1].domain,
          followersUrl: EXTERNAL_ACTORS[1].followers_url,
          inboxUrl: EXTERNAL_ACTORS[1].inbox_url,
          sharedInboxUrl: EXTERNAL_ACTORS[1].inbox_url,
          publicKey: 'publicKey',
          createdAt: currentTime
        })
        expect(actor).toEqual({
          id: urlToId(EXTERNAL_ACTORS[1].id),
          username: EXTERNAL_ACTORS[1].username,
          acct: `${EXTERNAL_ACTORS[1].username}@${EXTERNAL_ACTORS[1].domain}`,
          url: EXTERNAL_ACTORS[1].id,
          display_name: EXTERNAL_ACTORS[1].name,
          note: '',
          avatar: '',
          avatar_static: '',
          header: '',
          header_static: '',

          locked: true,
          fields: [],
          emojis: [],

          bot: false,
          group: false,
          discoverable: true,
          noindex: false,

          source: {
            fields: [],
            follow_requests_count: 0,
            language: 'en',
            note: '',
            privacy: 'public',
            sensitive: false
          },

          created_at: getISOTimeUTC(currentTime),
          last_status_at: null,

          statuses_count: 0,
          followers_count: 0,
          following_count: 0
        })
      })
    })

    describe('notification policy', () => {
      const policyActorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`

      it('returns the all-accept default when unset', async () => {
        const policy = await database.getNotificationPolicy({
          actorId: policyActorId
        })
        expect(policy).toEqual({
          for_not_following: 'accept',
          for_not_followers: 'accept',
          for_new_accounts: 'accept',
          for_private_mentions: 'accept',
          for_limited_accounts: 'accept'
        })
      })

      it('merges partial updates over the existing policy', async () => {
        await database.updateNotificationPolicy({
          actorId: policyActorId,
          for_not_following: 'filter'
        })
        await database.updateNotificationPolicy({
          actorId: policyActorId,
          for_new_accounts: 'drop'
        })

        const policy = await database.getNotificationPolicy({
          actorId: policyActorId
        })
        expect(policy).toEqual({
          for_not_following: 'filter',
          for_not_followers: 'accept',
          for_new_accounts: 'drop',
          for_private_mentions: 'accept',
          for_limited_accounts: 'accept'
        })
      })
    })

    describe('updateActor', () => {
      it('updates actor information and returns it in mastodon actor', async () => {
        await database.updateActor({
          actorId: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          name: 'name',
          summary: 'summary',
          iconUrl: 'iconUrl',
          headerImageUrl: 'headerImageUrl',
          publicKey: 'publicKey'
        })

        const actor = await database.getMastodonActorFromUsername({
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: TEST_USERNAME3,
          url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          display_name: 'name',
          note: 'summary',
          avatar: 'iconUrl',
          avatar_static: 'iconUrl',
          header: 'headerImageUrl',
          header_static: 'headerImageUrl',
          locked: true,
          fields: [],
          emojis: [],
          bot: false,
          group: false,
          discoverable: true,
          noindex: false,
          created_at: expect.toBeString(),
          last_status_at: null,
          statuses_count: 0,
          followers_count: 0,
          following_count: 0
        })
      })

      it('updates actor information and returns it in actor', async () => {
        await database.updateActor({
          actorId: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          name: 'name2',
          summary: 'summary2',
          iconUrl: 'iconUrl2',
          headerImageUrl: 'headerImageUrl2',
          publicKey: 'publicKey2'
        })

        const actor = await database.getActorFromUsername({
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`,
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: TEST_EMAIL
          },
          followersUrl: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}/followers`,
          publicKey: 'publicKey2',
          privateKey: expect.toBeString()
        })
      })

      it('updates actor type for refreshed remote actors', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `remote-service-${suffix}`
        const domain = `remote-service-${suffix}.test`
        const actorId = `https://${domain}/users/${username}`

        await database.createActor({
          actorId,
          type: 'Person',
          username,
          domain,
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `https://${domain}/inbox`,
          publicKey: 'public-key',
          createdAt: Date.now()
        })

        await database.updateActor({
          actorId,
          type: 'Service'
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor?.type).toBe('Service')

        const mastodonActor = await database.getMastodonActorFromUsername({
          username,
          domain
        })
        expect(mastodonActor?.bot).toBeTrue()
      })

      it('preserves other settings updates passed alongside an append', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        await database.updateActor({
          actorId,
          notificationAcceptedSenders: ['existing-sender']
        })

        await database.updateActor({
          actorId,
          appendNotificationAcceptedSenders: ['new-sender'],
          manuallyApprovesFollowers: false,
          defaultPrivacy: 'private'
        })

        const settings = await database.getActorSettings({ actorId })
        expect(settings.notificationAcceptedSenders).toEqual([
          'existing-sender',
          'new-sender'
        ])
        expect(settings.manuallyApprovesFollowers).toBe(false)
        expect(settings.defaultPrivacy).toBe('private')
      })

      it('persists and returns reading preferences', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        await database.updateActor({
          actorId,
          readingExpandMedia: 'show_all',
          readingExpandSpoilers: true,
          readingAutoplayGifs: true
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor?.readingExpandMedia).toEqual('show_all')
        expect(actor?.readingExpandSpoilers).toEqual(true)
        expect(actor?.readingAutoplayGifs).toEqual(true)
      })

      it('round-trips false reading preference values', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        await database.updateActor({
          actorId,
          readingExpandSpoilers: false,
          readingAutoplayGifs: false
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor?.readingExpandSpoilers).toEqual(false)
        expect(actor?.readingAutoplayGifs).toEqual(false)
      })

      it('preserves existing settings when updating reading preferences', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        await database.updateActor({ actorId, defaultPrivacy: 'unlisted' })

        await database.updateActor({ actorId, readingExpandMedia: 'hide_all' })

        const settings = await database.getActorSettings({ actorId })
        expect(settings.defaultPrivacy).toEqual('unlisted')
        expect(settings.readingExpandMedia).toEqual('hide_all')
      })
    })

    describe('getActorSettings', () => {
      it('returns actor settings', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        const settings = await database.getActorSettings({ actorId })
        expect(settings).toMatchObject({
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`
        })
      })

      it('returns updated actor settings', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        await database.updateActor({
          actorId,
          manuallyApprovesFollowers: false,
          followersUrl: `${actorId}/followers-updated`
        })

        const settings = await database.getActorSettings({ actorId })
        expect(settings).toMatchObject({
          followersUrl: `${actorId}/followers-updated`,
          manuallyApprovesFollowers: false
        })
      })

      it('persists and returns postLineLimit setting', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`

        await database.updateActor({ actorId, postLineLimit: 10 })
        let settings = await database.getActorSettings({ actorId })
        expect(settings?.postLineLimit).toBe(10)

        await database.updateActor({ actorId, postLineLimit: 0 })
        settings = await database.getActorSettings({ actorId })
        expect(settings?.postLineLimit).toBe(0)

        await database.updateActor({ actorId, postLineLimit: 5 })
        settings = await database.getActorSettings({ actorId })
        expect(settings?.postLineLimit).toBe(5)
      })

      it('returns undefined postLineLimit for actors without the setting', async () => {
        const actorId = EXTERNAL_ACTORS[0].id
        const settings = await database.getActorSettings({ actorId })
        expect(settings?.postLineLimit).toBeUndefined()
      })
    })

    describe('deleteActor', () => {
      it('deletes actor by id', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.deleteActor({ actorId })
        const deleted = await database.getActorFromId({ id: actorId })
        expect(deleted).toBeNull()
      })
    })

    describe('isInternalActor', () => {
      it('returns true when actor is internal', async () => {
        const result = await database.isInternalActor({
          actorId: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        })
        expect(result).toBeTrue()
      })

      it('returns true for the headless instance actor', async () => {
        const actor = await database.getFederationSigningActor()
        if (!actor) fail('Expected federation signing actor')

        const result = await database.isInternalActor({
          actorId: actor.id
        })
        expect(result).toBeTrue()
      })

      it('returns false for non-signer accountless local service actors', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `local-service-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createActor({
          actorId,
          type: 'Service',
          username,
          domain: TEST_DOMAIN,
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
          publicKey: 'public-key',
          privateKey: 'private-key',
          createdAt: Date.now()
        })

        const result = await database.isInternalActor({ actorId })
        expect(result).toBeFalse()
      })

      it('returns false when actor is external', async () => {
        const result = await database.isInternalActor({
          actorId: EXTERNAL_ACTORS[0].id
        })
        expect(result).toBeFalse()
      })

      it('returns false when actor is not exists', async () => {
        const result = await database.isInternalActor({
          actorId: 'https://notfound.test/actor'
        })
        expect(result).toBeFalse()
      })
    })

    describe('scheduleActorDeletion', () => {
      it('schedules immediate deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `schedule-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('scheduled')
        expect(status?.scheduledAt).toBeNull()
      })

      it('schedules delayed deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `schedule-del2-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        await database.scheduleActorDeletion({ actorId, scheduledAt })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('scheduled')
        expect(status?.scheduledAt).toBeNumber()
      })
    })

    describe('cancelActorDeletion', () => {
      it('cancels scheduled deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `cancel-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        await database.cancelActorDeletion({ actorId })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toBeNull()
        expect(status?.scheduledAt).toBeNull()
      })
    })

    describe('startActorDeletion', () => {
      it('starts deletion process', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `start-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        await database.startActorDeletion({ actorId })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('deleting')
      })
    })

    describe('getActorsScheduledForDeletion', () => {
      it('returns actors scheduled for deletion before given date', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `get-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const pastDate = new Date(Date.now() - 1000)
        await database.scheduleActorDeletion({ actorId, scheduledAt: pastDate })
        const actors = await database.getActorsScheduledForDeletion({
          beforeDate: new Date()
        })
        expect(actors.some((a) => a.id === actorId)).toBeTrue()
      })

      it('does not return actors scheduled for future deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `get-del2-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await database.scheduleActorDeletion({
          actorId,
          scheduledAt: futureDate
        })
        const actors = await database.getActorsScheduledForDeletion({
          beforeDate: new Date()
        })
        expect(actors.some((a) => a.id === actorId)).toBeFalse()
      })
    })

    describe('getNodeInfoStats', () => {
      it('increments totalUsers and localPosts counters on create', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `nodeinfo-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const statusId = `${actorId}/statuses/nodeinfo-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'NodeInfo test status'
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.totalUsers).toBe(statsBefore.totalUsers + 1)
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts + 1)
      })

      it('does not count external actors in local stats', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const externalActorId = `https://external-${suffix}.example/users/ext`

        await database.createActor({
          actorId: externalActorId,
          username: `ext-${suffix}`,
          domain: `external-${suffix}.example`,
          followersUrl: `${externalActorId}/followers`,
          inboxUrl: `${externalActorId}/inbox`,
          sharedInboxUrl: `${externalActorId}/inbox`,
          publicKey: 'externalPublicKey',
          createdAt: Date.now()
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.totalUsers).toBe(statsBefore.totalUsers)
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts)
      })

      it('does not count external actor posts in local stats', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const externalActorId = `https://ext-post-${suffix}.example/users/ext`

        await database.createActor({
          actorId: externalActorId,
          username: `ext-post-${suffix}`,
          domain: `ext-post-${suffix}.example`,
          followersUrl: `${externalActorId}/followers`,
          inboxUrl: `${externalActorId}/inbox`,
          sharedInboxUrl: `${externalActorId}/inbox`,
          publicKey: 'externalPublicKey',
          createdAt: Date.now()
        })

        await database.createNote({
          id: `${externalActorId}/statuses/ext-${suffix}`,
          url: `${externalActorId}/statuses/ext-${suffix}`,
          actorId: externalActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'External post'
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts)
      })
    })

    describe('deleteActorData', () => {
      it('removes the deleted actor featured tags', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-featured-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createFeaturedTag({ actorId, name: 'cleanup' })
        expect(await database.countFeaturedTags({ actorId })).toBe(1)

        await database.deleteActorData({ actorId })

        expect(await database.countFeaturedTags({ actorId })).toBe(0)
      })

      it('removes account notes referencing the deleted actor on either side', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-note-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        const peerActorId = `https://${TEST_DOMAIN}/users/delete-note-peer-${suffix}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createAccount({
          email: `peer-${suffix}@${TEST_DOMAIN}`,
          username: `delete-note-peer-${suffix}`,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-peer-${suffix}`,
          publicKey: `publicKey-peer-${suffix}`
        })

        // Note authored by the actor, and a note targeting the actor.
        await database.upsertAccountNote({
          actorId,
          targetActorId: peerActorId,
          comment: 'note I wrote'
        })
        await database.upsertAccountNote({
          actorId: peerActorId,
          targetActorId: actorId,
          comment: 'note about me'
        })

        await database.deleteActorData({ actorId })

        await expect(
          database.getAccountNote({ actorId, targetActorId: peerActorId })
        ).resolves.toBe('')
        await expect(
          database.getAccountNote({
            actorId: peerActorId,
            targetActorId: actorId
          })
        ).resolves.toBe('')
      })

      it('deletes actor data and keeps related counters consistent', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-data-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        const peerUsername = `delete-data-peer-${suffix}`
        const peerActorId = `https://${TEST_DOMAIN}/users/${peerUsername}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createAccount({
          email: `${peerUsername}@${TEST_DOMAIN}`,
          username: peerUsername,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-peer-${suffix}`,
          publicKey: `publicKey-peer-${suffix}`
        })

        const targetStatusId = `${peerActorId}/statuses/delete-data-target-${suffix}`
        const pollStatusId = `${peerActorId}/statuses/delete-data-poll-${suffix}`
        const replyStatusId = `${actorId}/statuses/reply-${suffix}`
        const actorHashtag = `actor-delete-${suffix}`
        await database.createNote({
          id: targetStatusId,
          url: targetStatusId,
          actorId: peerActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Target status'
        })
        await database.createPoll({
          id: pollStatusId,
          url: pollStatusId,
          actorId: peerActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Peer poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000
        })

        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply from actor to delete',
          reply: targetStatusId
        })
        await database.createTag({
          statusId: replyStatusId,
          type: 'hashtag',
          name: `#${actorHashtag}`,
          value: `https://${TEST_DOMAIN}/tags/${actorHashtag}`
        })
        await database.increaseHashtagCounter({ hashtag: actorHashtag })
        await database.createAnnounce({
          id: `${actorId}/statuses/reblog-${suffix}`,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: targetStatusId
        })
        await database.createLike({
          actorId,
          statusId: targetStatusId
        })
        await database.createFollow({
          actorId,
          targetActorId: peerActorId,
          inbox: `${actorId}/inbox`,
          sharedInbox: `${actorId}/inbox`,
          status: 'Accepted'
        })
        await database.createFollow({
          actorId: peerActorId,
          targetActorId: actorId,
          inbox: `${peerActorId}/inbox`,
          sharedInbox: `${peerActorId}/inbox`,
          status: 'Accepted'
        })
        await database.createMedia({
          actorId,
          original: {
            path: `/tmp/delete-data-${suffix}.jpg`,
            bytes: 1700,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        await expect(
          database.recordPollVotes({
            statusId: pollStatusId,
            actorId,
            choices: [0]
          })
        ).resolves.toBeTrue()
        await database.createPollAnswer({
          statusId: pollStatusId,
          actorId,
          choice: 0
        })

        const actor = await database.getActorFromId({ id: actorId })
        const accountId = actor?.account?.id
        expect(accountId).toBeDefined()
        await expect(
          database.hasActorVoted({ statusId: pollStatusId, actorId })
        ).resolves.toBeTrue()
        const pollBeforeDelete = (await database.getStatus({
          statusId: pollStatusId,
          currentActorId: peerActorId
        })) as StatusPoll
        expect(pollBeforeDelete.choices[0]).toMatchObject({ totalVotes: 1 })

        const [
          beforeFollowers,
          beforeFollowing,
          beforeLikes,
          beforeReblogs,
          beforeReplies,
          beforeHashtagCount,
          beforeMediaUsage,
          beforeNodeInfo
        ] = await Promise.all([
          database.getActorFollowersCount({ actorId: peerActorId }),
          database.getActorFollowingCount({ actorId: peerActorId }),
          database.getLikeCount({ statusId: targetStatusId }),
          database.getStatusReblogsCount({ statusId: targetStatusId }),
          database.getStatusRepliesCount({ statusId: targetStatusId }),
          database.getHashtagCounter({ hashtag: actorHashtag }),
          database.getStorageUsageForAccount({ accountId: accountId! }),
          database.getNodeInfoStats()
        ])

        await database.deleteActorData({ actorId })

        const deletedActor = await database.getActorFromId({ id: actorId })
        expect(deletedActor).toBeNull()
        await expect(
          database.hasActorVoted({ statusId: pollStatusId, actorId })
        ).resolves.toBeFalse()
        await expect(
          database.getActorPollVotes({ statusId: pollStatusId, actorId })
        ).resolves.toEqual([])
        const pollAfterDelete = (await database.getStatus({
          statusId: pollStatusId,
          currentActorId: peerActorId
        })) as StatusPoll
        expect(pollAfterDelete.choices[0]).toMatchObject({ totalVotes: 0 })

        const [
          afterFollowers,
          afterFollowing,
          afterLikes,
          afterReblogs,
          afterReplies,
          afterHashtagCount,
          afterMediaUsage,
          afterNodeInfo
        ] = await Promise.all([
          database.getActorFollowersCount({ actorId: peerActorId }),
          database.getActorFollowingCount({ actorId: peerActorId }),
          database.getLikeCount({ statusId: targetStatusId }),
          database.getStatusReblogsCount({ statusId: targetStatusId }),
          database.getStatusRepliesCount({ statusId: targetStatusId }),
          database.getHashtagCounter({ hashtag: actorHashtag }),
          database.getStorageUsageForAccount({ accountId: accountId! }),
          database.getNodeInfoStats()
        ])

        expect(afterFollowers).toBe(beforeFollowers - 1)
        expect(afterFollowing).toBe(beforeFollowing - 1)
        expect(afterLikes).toBe(beforeLikes - 1)
        expect(afterReblogs).toBe(beforeReblogs - 1)
        expect(afterReplies).toBe(beforeReplies - 1)
        expect(afterHashtagCount).toBe(beforeHashtagCount - 1)
        expect(afterMediaUsage).toBe(beforeMediaUsage - 1700)
        expect(afterNodeInfo.totalUsers).toBe(beforeNodeInfo.totalUsers - 1)
        expect(afterNodeInfo.localPosts).toBe(beforeNodeInfo.localPosts - 2)
      })

      it('deletes owned status-scoped data with direct status id cleanup', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/delete-actor-status-data'
        const voterId = 'https://remote.test/users/delete-actor-voter'
        const noteId = `${actorId}/statuses/history-cleanup`
        const pollId = `${actorId}/statuses/poll-cleanup`
        const queries: string[] = []
        const handleQuery = ({ sql }: { sql: string }) => {
          queries.push(sql.toLowerCase())
        }
        const currentTime = new Date()
        const countRows = async (tableName: string, statusId: string) => {
          const row = await knexDatabase(tableName)
            .where({ statusId })
            .count<{ count: number | string }>('* as count')
            .first()
          return Number(row?.count ?? 0)
        }

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'delete-actor-status-data',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createActor({
            actorId: voterId,
            username: 'delete-actor-voter',
            domain: 'remote.test',
            followersUrl: `${voterId}/followers`,
            inboxUrl: `${voterId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'voter-public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: noteId,
            url: noteId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Original history cleanup note'
          })
          await sqlDatabase.updateNote({
            statusId: noteId,
            text: 'Updated history cleanup note'
          })
          await sqlDatabase.createPoll({
            id: pollId,
            url: pollId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Poll cleanup',
            choices: ['One', 'Two'],
            endAt: Date.now() + 60_000
          })
          await sqlDatabase.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0]
          })
          await knexDatabase('notifications').insert({
            id: 'delete-actor-status-notification',
            actorId: voterId,
            type: 'mention',
            sourceActorId: voterId,
            statusId: noteId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('direct_conversation_statuses').insert({
            conversationId: 'delete-actor-status-conversation',
            statusId: noteId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('fitness_files').insert({
            id: 'delete-actor-status-fitness-file',
            actorId: voterId,
            statusId: noteId,
            path: '/tmp/delete-actor-status.fit',
            fileName: 'delete-actor-status.fit',
            fileType: 'fit',
            mimeType: 'application/octet-stream',
            bytes: 100,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('counters').insert(
            [noteId, pollId]
              .flatMap((statusId) => [
                CounterKey.totalLike(statusId),
                CounterKey.totalReblog(statusId),
                CounterKey.totalReply(statusId)
              ])
              .map((id) => ({
                id,
                value: 1,
                createdAt: currentTime,
                updatedAt: currentTime
              }))
          )

          await expect(countRows('status_history', noteId)).resolves.toBe(1)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(1)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(1)
          await expect(countRows('notifications', noteId)).resolves.toBe(1)
          await expect(
            countRows('direct_conversation_statuses', noteId)
          ).resolves.toBe(1)
          await expect(countRows('fitness_files', noteId)).resolves.toBe(1)

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteActorData({ actorId })
          knexDatabase.off('query', handleQuery)

          await expect(countRows('status_history', noteId)).resolves.toBe(0)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(0)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(0)
          await expect(countRows('notifications', noteId)).resolves.toBe(0)
          await expect(
            countRows('direct_conversation_statuses', noteId)
          ).resolves.toBe(0)
          await expect(countRows('fitness_files', noteId)).resolves.toBe(0)
          await expect(
            knexDatabase('fitness_files')
              .where({ id: 'delete-actor-status-fitness-file' })
              .first('statusId')
          ).resolves.toEqual({ statusId: null })
          await expect(
            knexDatabase('counters')
              .whereIn(
                'id',
                [noteId, pollId].flatMap((statusId) => [
                  CounterKey.totalLike(statusId),
                  CounterKey.totalReblog(statusId),
                  CounterKey.totalReply(statusId)
                ])
              )
              .count<{ count: number | string }>('* as count')
              .first()
              .then((row) => Number(row?.count ?? 0))
          ).resolves.toBe(0)
          const hasDirectStatusIdDelete = (tableName: string) =>
            queries.some(
              (sql) =>
                sql.startsWith('delete') &&
                sql.includes(`\`${tableName}\``) &&
                sql.includes('`statusid` in') &&
                !sql.includes('`actorid` in')
            )
          expect(hasDirectStatusIdDelete('status_history')).toBe(true)
          expect(hasDirectStatusIdDelete('poll_answers')).toBe(true)
          expect(hasDirectStatusIdDelete('poll_voters')).toBe(true)
          expect(hasDirectStatusIdDelete('notifications')).toBe(true)
          expect(hasDirectStatusIdDelete('direct_conversation_statuses')).toBe(
            true
          )
          expect(
            queries.some(
              (sql) =>
                sql.startsWith('update') &&
                sql.includes('`fitness_files`') &&
                sql.includes('`statusid` in')
            )
          ).toBe(true)
          expect(
            queries.some(
              (sql) =>
                sql.startsWith('delete') &&
                sql.includes('`counters`') &&
                sql.includes('`id` in')
            )
          ).toBe(true)
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
      })

      it('deletes markers when actor is deleted', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-markers-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.upsertMarker({
          actorId,
          timeline: 'home',
          lastReadId: 'marker-delete-test'
        })
        await database.upsertMarker({
          actorId,
          timeline: 'notifications',
          lastReadId: 'marker-delete-test-2'
        })

        const before = await database.getMarkers({
          actorId,
          timelines: ['home', 'notifications']
        })
        expect(before).toHaveLength(2)

        await database.deleteActorData({ actorId })

        const after = await database.getMarkers({
          actorId,
          timelines: ['home', 'notifications']
        })
        expect(after).toEqual([])
      })
    })
  })
})
