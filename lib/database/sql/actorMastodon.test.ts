import crypto from 'crypto'

import {
  createActorPublicIdReader,
  createFreshDatabaseRunner,
  createSigningAccount,
  seedActorTestDatabase
} from '@/lib/database/sql/actorTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { FEDERATION_SIGNING_ACTOR_USERNAME } from '@/lib/services/federation/instanceActor'
import {
  EXTERNAL_ACTORS,
  TEST_DOMAIN,
  TEST_DOMAIN_2,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME3
} from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

describe('ActorDatabase mastodon actors', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (backendName, database) => {
    const withFreshDatabase = createFreshDatabaseRunner(backendName)
    const withFreshDatabaseAndInstance = withFreshDatabase

    // publicIds are minted at insert and random per run, so expectations read
    // them back off the stored row instead of hard-coding a literal.
    const getActorPublicId = createActorPublicIdReader(database)

    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    describe('mastodon actor', () => {
      it.each([
        [
          'id',
          () =>
            database.getMastodonActorFromId({
              id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
            })
        ],
        [
          'username',
          () =>
            database.getMastodonActorFromUsername({
              username: TEST_USERNAME3,
              domain: TEST_DOMAIN
            })
        ],
        [
          'email',
          () => database.getMastodonActorFromEmail({ email: TEST_EMAIL })
        ]
      ])('returns mastodon actor from %s', async (_, lookup) => {
        const actor = await lookup()

        expect(actor).toMatchObject({
          id: await getActorPublicId(
            `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
          ),
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

      it('serializes uri, roles, indexable and hide_collections with defaults', async () => {
        const id = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        const actor = await database.getMastodonActorFromId({ id })

        expect(actor).toMatchObject({
          uri: id,
          roles: [],
          indexable: false,
          hide_collections: null
        })
        expect(actor?.source.attribution_domains).toEqual([])
      })

      it('serializes persisted modern flags and attribution domains', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `modern-serialize-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)
        await database.updateActor({
          actorId,
          indexable: true,
          hideCollections: true,
          attributionDomains: ['blog.example.com']
        })

        const actor = await database.getMastodonActorFromId({ id: actorId })

        expect(actor).toMatchObject({
          indexable: true,
          hide_collections: true
        })
        expect(actor?.source.attribution_domains).toEqual(['blog.example.com'])
      })

      it('serializes custom emojis from actor settings tags', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `emoji-actor-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)
        await database.updateActor({
          actorId,
          tags: [
            {
              type: 'emoji',
              name: ':blobcat:',
              value: 'https://example.com/emojis/blobcat.png'
            }
          ]
        })

        const actor = await database.getMastodonActorFromId({ id: actorId })
        expect(actor?.emojis).toEqual([
          {
            shortcode: 'blobcat',
            url: 'https://example.com/emojis/blobcat.png',
            static_url: 'https://example.com/emojis/blobcat.png',
            visible_in_picker: true,
            category: null
          }
        ])
      })

      it('automatically resolves local custom emoji when display name is updated', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `autoresolve-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.createCustomEmoji({
          shortcode: 'partyblob',
          url: 'https://example.com/partyblob.png',
          staticUrl: 'https://example.com/partyblob.png'
        })

        await database.updateActor({
          actorId,
          name: 'Alice :partyblob:'
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor?.tags).toEqual([
          {
            type: 'emoji',
            name: ':partyblob:',
            value: 'https://example.com/partyblob.png'
          }
        ])

        const mastodonActor = await database.getMastodonActorFromId({
          id: actorId
        })
        expect(mastodonActor?.emojis).toEqual([
          {
            shortcode: 'partyblob',
            url: 'https://example.com/partyblob.png',
            static_url: 'https://example.com/partyblob.png',
            visible_in_picker: true,
            category: null
          }
        ])
      })

      it('automatically resolves local custom emoji when profile fields are updated', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `autoresolve-fields-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.createCustomEmoji({
          shortcode: 'fieldblob',
          url: 'https://example.com/fieldblob.png',
          staticUrl: 'https://example.com/fieldblob.png'
        })

        await database.updateActor({
          actorId,
          fields: [{ name: 'Pronouns', value: ':fieldblob:' }]
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor?.tags).toEqual([
          {
            type: 'emoji',
            name: ':fieldblob:',
            value: 'https://example.com/fieldblob.png'
          }
        ])
      })

      it('serializes suspended actors with suspended: true and silenced actors with limited: true', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const suspendedUsername = `suspended-${suffix}`
          const silencedUsername = `silenced-${suffix}`
          await createSigningAccount(database, suspendedUsername)
          await createSigningAccount(database, silencedUsername)
          const suspendedId = `https://${TEST_DOMAIN}/users/${suspendedUsername}`
          const silencedId = `https://${TEST_DOMAIN}/users/${silencedUsername}`
          await database.setActorSuspended({
            actorId: suspendedId,
            suspended: true
          })
          await database.setActorSilenced({
            actorId: silencedId,
            silenced: true
          })

          const suspended = await database.getMastodonActorFromId({
            id: suspendedId
          })
          const silenced = await database.getMastodonActorFromId({
            id: silencedId
          })

          expect(suspended?.suspended).toBe(true)
          expect(suspended?.limited).toBeUndefined()
          expect(silenced?.limited).toBe(true)
          expect(silenced?.suspended).toBeUndefined()
        })
      })

      it('excludes suspended and silenced actors from getLocalMastodonActors', async () => {
        await withFreshDatabase(async (database) => {
          const suffix = crypto.randomUUID().slice(0, 8)
          const activeUsername = `active-${suffix}`
          const suspendedUsername = `dir-suspended-${suffix}`
          const silencedUsername = `dir-silenced-${suffix}`
          await createSigningAccount(database, activeUsername)
          await createSigningAccount(database, suspendedUsername)
          await createSigningAccount(database, silencedUsername)
          await database.setActorSuspended({
            actorId: `https://${TEST_DOMAIN}/users/${suspendedUsername}`,
            suspended: true
          })
          await database.setActorSilenced({
            actorId: `https://${TEST_DOMAIN}/users/${silencedUsername}`,
            silenced: true
          })

          const actors = await database.getLocalMastodonActors({
            localDomain: TEST_DOMAIN,
            limit: 40,
            offset: 0
          })
          const usernames = actors.map((actor) => actor.username)
          expect(usernames).toContain(activeUsername)
          expect(usernames).not.toContain(suspendedUsername)
          expect(usernames).not.toContain(silencedUsername)
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

      it('falls back to the legacy id for an actor that predates the backfill', async () => {
        await withFreshDatabaseAndInstance(async (freshDatabase, instance) => {
          const actorId = `https://${TEST_DOMAIN}/users/legacy-account-id`
          await freshDatabase.createActor({
            actorId,
            username: 'legacy-account-id',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await instance('actors').where('id', actorId).update({
            publicId: null
          })

          const actor = await freshDatabase.getMastodonActorFromId({
            id: actorId
          })

          expect(actor?.id).toBe(urlToId(actorId))
          expect(actor?.url).toBe(actorId)
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
        expect(actor).toMatchObject({
          username: EXTERNAL_ACTORS[0].username,
          domain: EXTERNAL_ACTORS[0].domain,
          followersUrl: EXTERNAL_ACTORS[0].followers_url,
          inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          publicKey: 'publicKey'
        })
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
          id: await getActorPublicId(EXTERNAL_ACTORS[1].id),
          username: EXTERNAL_ACTORS[1].username,
          acct: `${EXTERNAL_ACTORS[1].username}@${EXTERNAL_ACTORS[1].domain}`,
          url: EXTERNAL_ACTORS[1].id,
          uri: EXTERNAL_ACTORS[1].id,
          display_name: EXTERNAL_ACTORS[1].name,
          note: '',
          avatar: '',
          avatar_static: '',
          avatar_description: '',
          header: '',
          header_static: '',
          header_description: '',

          locked: true,
          fields: [],
          emojis: [],

          bot: false,
          group: false,
          discoverable: true,
          noindex: false,
          roles: [],
          indexable: false,
          hide_collections: null,

          source: {
            fields: [],
            follow_requests_count: 0,
            language: 'en',
            note: '',
            privacy: 'public',
            sensitive: false,
            quote_policy: 'public',
            attribution_domains: []
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
      it('returns the all-accept default when unset', async () => {
        const policy = await database.getNotificationPolicy({
          actorId: `https://${TEST_DOMAIN}/users/policy-unset`
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
        const username = `policy-${crypto.randomUUID().slice(0, 8)}`
        const policyActorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
  })
})
