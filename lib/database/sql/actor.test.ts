import crypto from 'crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  EXTERNAL_ACTORS,
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME3
} from '@/lib/stub/const'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

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

    describe('mastodon actor', () => {
      it('returns mastodon actor from id', async () => {
        const actor = await database.getMastodonActorFromId({
          id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: `${TEST_USERNAME3}@${TEST_DOMAIN}`,
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

      it('returns mastodon actor from username', async () => {
        const actor = await database.getMastodonActorFromUsername({
          username: TEST_USERNAME3,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`),
          username: TEST_USERNAME3,
          acct: `${TEST_USERNAME3}@${TEST_DOMAIN}`,
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
          acct: `${TEST_USERNAME3}@${TEST_DOMAIN}`,
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

    describe('#updateActor', () => {
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
          acct: `${TEST_USERNAME3}@${TEST_DOMAIN}`,
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
    })

    describe('#getActorSettings', () => {
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
    })

    describe('#deleteActor', () => {
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
        expect(deleted).toBeUndefined()
      })
    })

    describe('#isInternalActor', () => {
      it('returns true when actor is internal', async () => {
        const result = await database.isInternalActor({
          actorId: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        })
        expect(result).toBeTrue()
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

    describe('#scheduleActorDeletion', () => {
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

    describe('#cancelActorDeletion', () => {
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

    describe('#startActorDeletion', () => {
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

    describe('#getActorsScheduledForDeletion', () => {
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

    describe('#deleteActorData', () => {
      it('deletes all actor data', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-data-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        // Create some data for the actor
        await database.createNote({
          id: `${actorId}/statuses/test-${suffix}`,
          url: `${actorId}/statuses/test-${suffix}`,
          actorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Test status',
          createdAt: Date.now()
        })

        // Delete actor data
        await database.deleteActorData({ actorId })

        // Verify actor is deleted
        const actor = await database.getActorFromId({ id: actorId })
        expect(actor).toBeUndefined()
      })
    })
  })
})
