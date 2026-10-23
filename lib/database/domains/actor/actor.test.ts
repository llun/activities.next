import crypto from 'crypto'
import { sql } from 'kysely'

import {
  createActorPublicIdReader,
  createSigningAccount,
  seedActorTestDatabase
} from '@/lib/database/domains/actor/actorTestHelpers'
import { getActor } from '@/lib/database/domains/actor/rows'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { holdTransaction } from '@/lib/database/testing/heldTransaction'
import {
  EXTERNAL_ACTORS,
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_USERNAME3
} from '@/lib/stub/const'

describe('ActorDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (backend, database) => {
    // publicIds are minted at insert and random per run, so expectations read
    // them back off the stored row instead of hard-coding a literal.
    const getActorPublicId = createActorPublicIdReader(database)

    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    describe('getActor', () => {
      it('falls back to Person for unknown persisted actor types', () => {
        const actor = getActor(
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

    describe('setActorCounters and hasActorCounters', () => {
      it('reports unsynced counters for a freshly-created actor', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/counters-unsynced`
        await database.createActor({
          actorId,
          username: 'counters-unsynced',
          domain: TEST_DOMAIN,
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `${actorId}/inbox`,
          publicKey: 'publicKey',
          createdAt: Date.now()
        })

        await expect(
          database.hasActorCounters({ actorId })
        ).resolves.toBeFalse()
      })

      it('stores provided counts and serves them on the Mastodon account', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/counters-set`
        await database.createActor({
          actorId,
          username: 'counters-set',
          domain: 'counters.example',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `${actorId}/inbox`,
          publicKey: 'publicKey',
          createdAt: Date.now()
        })

        await database.setActorCounters({
          actorId,
          followersCount: 5370,
          followingCount: 519,
          statusCount: 641
        })

        await expect(database.hasActorCounters({ actorId })).resolves.toBeTrue()
        await expect(
          database.getMastodonActorFromId({ id: actorId })
        ).resolves.toMatchObject({
          followers_count: 5370,
          following_count: 519,
          statuses_count: 641
        })
      })

      it('preserves existing counter values for null counts while marking them synced', async () => {
        const actorId = `https://${TEST_DOMAIN}/users/counters-partial`
        await database.createActor({
          actorId,
          username: 'counters-partial',
          domain: 'counters.example',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: `${actorId}/inbox`,
          publicKey: 'publicKey',
          createdAt: Date.now()
        })
        await database.createNote({
          id: `${actorId}/statuses/counted`,
          url: `${actorId}/statuses/counted`,
          actorId,
          text: 'counted',
          to: [],
          cc: []
        })

        await database.setActorCounters({
          actorId,
          followersCount: 12,
          followingCount: null,
          statusCount: null
        })

        await expect(database.hasActorCounters({ actorId })).resolves.toBeTrue()
        await expect(
          database.getMastodonActorFromId({ id: actorId })
        ).resolves.toMatchObject({
          followers_count: 12,
          following_count: 0,
          statuses_count: 1
        })
      })
    })

    describe('deprecated actor', () => {
      it.each([
        [
          'id',
          () =>
            database.getActorFromId({
              id: `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
            })
        ],
        [
          'username',
          () =>
            database.getActorFromUsername({
              username: TEST_USERNAME3,
              domain: TEST_DOMAIN
            })
        ],
        ['email', () => database.getActorFromEmail({ email: TEST_EMAIL })]
      ])('returns actor from %s', async (_, lookup) => {
        const id = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
        const actor = await lookup()

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
    })

    describe('updateActor', () => {
      it('updates actor information and returns it in mastodon actor', async () => {
        const username = `update-mastodon-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({
          actorId,
          name: 'name',
          summary: 'summary',
          iconUrl: 'iconUrl',
          headerImageUrl: 'headerImageUrl',
          publicKey: 'publicKey'
        })

        const actor = await database.getMastodonActorFromId({ id: actorId })

        expect(actor).toMatchObject({
          id: await getActorPublicId(actorId),
          username,
          acct: username,
          url: actorId,
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

      it('updateActorWithPrevious returns the row as it was at write time and the saved one', async () => {
        const username = `update-previous-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({ actorId, name: 'New' })
        const result = await database.updateActorWithPrevious({
          actorId,
          name: 'Old'
        })

        expect(result.before?.name).toBe('New')
        expect(result.after?.name).toBe('Old')
        expect((await database.getActorFromId({ id: actorId }))?.name).toBe(
          'Old'
        )
      })

      it('updateActorWithPrevious reads the row under the write lock when two saves race', async () => {
        const username = `update-race-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)
        await database.updateActor({ actorId, name: 'Orig' })

        const results = await Promise.all([
          database.updateActorWithPrevious({ actorId, name: 'A' }),
          database.updateActorWithPrevious({ actorId, name: 'B' })
        ])

        // Either save may take the lock first, but the second must see the
        // first one's write as its `before`; a read outside the lock would
        // give 'Orig->A' and 'Orig->B'. This reliably catches a read outside
        // the transaction on SQLite, where the transaction owns the one
        // connection. On PostgreSQL the two saves rarely overlap, so it
        // seldom catches a read moved before the lock; the next test covers
        // that ordering.
        expect(results[0].after?.name).toBe('A')
        expect(results[1].after?.name).toBe('B')
        const firsts = results.filter(({ before }) => before?.name === 'Orig')
        expect(firsts).toHaveLength(1)
        const second = results.find((result) => result !== firsts[0])
        expect(second?.before?.name).toBe(firsts[0].after?.name)
      })

      it.runIf(backend === 'pg')(
        'updateActorWithPrevious reads its before snapshot only after the actor row lock is granted',
        async () => {
          const username = `update-held-${crypto.randomUUID().slice(0, 8)}`
          const actorId = `https://${TEST_DOMAIN}/users/${username}`
          await createSigningAccount(database, username)
          await database.updateActor({ actorId, name: 'Orig' })

          // A second pool on this worker's database (no prepare, no migrate):
          // one connection holds the lock, another polls for the wait.
          const raw = createTestDatabase({ backend: 'pg' })
          const held = await holdTransaction(raw.db)
          let pending:
            ReturnType<typeof database.updateActorWithPrevious> | undefined
          try {
            await held.trx
              .selectFrom('actors')
              .select('id')
              .where('id', '=', actorId)
              .forUpdate()
              .executeTakeFirstOrThrow()
            await held.trx
              .updateTable('actors')
              .set({ name: 'Held' })
              .where('id', '=', actorId)
              .execute()

            pending = database.updateActorWithPrevious({ actorId, name: 'B' })
            // The save is waiting once a backend of this database waits on a
            // lock; nothing else here takes one.
            const deadline = Date.now() + 5000
            for (;;) {
              const { rows } = await sql<{ waiting: number }>`
                select count(*)::int as waiting
                from pg_stat_activity
                where datname = current_database()
                  and wait_event_type = 'Lock'
                  and pid <> pg_backend_pid()
              `.execute(raw.db)
              if (rows[0].waiting > 0) break
              if (Date.now() > deadline) {
                throw new Error(
                  'updateActorWithPrevious never waited for the actor row lock'
                )
              }
              await new Promise((resolve) => setTimeout(resolve, 20))
            }
            await held.commit()
          } catch (error) {
            await held.rollback()
            throw error
          } finally {
            // Settle the save before the pool goes, so a failed run leaves no
            // dangling query.
            await pending?.catch(() => undefined)
            await raw.destroy()
          }

          const { before, after } = await (pending as NonNullable<
            typeof pending
          >)
          expect(before?.name).toBe('Held')
          expect(after?.name).toBe('B')
        }
      )

      it('updateActorWithPrevious returns null for both when the actor does not exist', async () => {
        const result = await database.updateActorWithPrevious({
          actorId: `https://${TEST_DOMAIN}/users/missing-${crypto.randomUUID().slice(0, 8)}`,
          name: 'Nobody'
        })

        expect(result).toEqual({ before: null, after: null })
      })

      it('sanitizes the HTML note, escapes a local field value as text and keeps source raw', async () => {
        const username = `xss-note-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        const rawNote =
          '<p>hi<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a></p>'
        const rawFieldValue =
          '<a href="https://example.com" onclick="alert(4)">site</a><img src=x onerror=alert(5)>'
        await database.updateActor({
          actorId,
          summary: rawNote,
          fields: [{ name: 'Site', value: rawFieldValue }]
        })

        const actor = await database.getMastodonActorFromId({ id: actorId })
        if (!actor) throw new Error('actor not found')
        expect(actor.note).toBe('<p>hi<a>x</a></p>')
        // A local field value is plain text, so markup in it is shown as text.
        expect(actor.fields).toEqual([
          {
            name: 'Site',
            value:
              '&lt;a href=&quot;https://example.com&quot; onclick=&quot;alert(4)&quot;&gt;site&lt;/a&gt;&lt;img src=x onerror=alert(5)&gt;',
            verified_at: null
          }
        ])
        expect(actor.fields[0].value).not.toContain('<')
        // `source` is the plain editing copy the owner round-trips.
        expect(actor.source.note).toBe(rawNote)
        expect(actor.source.fields[0].value).toBe(rawFieldValue)
      })

      it('surfaces avatar/header alt text as the Mastodon 4.6 description fields', async () => {
        const username = `alt-desc-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({
          actorId,
          avatarDescription: 'A close-up of a coffee cup',
          headerDescription: 'Mountains at dawn'
        })

        const actor = await database.getMastodonActorFromId({ id: actorId })

        // Both are required members of the Account entity as of Mastodon 4.6.
        expect(actor).toMatchObject({
          avatar_description: 'A close-up of a coffee cup',
          header_description: 'Mountains at dawn'
        })
      })

      it('defaults the 4.6 description fields to empty strings when unset', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `no-alt-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        const actor = await database.getMastodonActorFromId({ id: actorId })

        expect(actor).toMatchObject({
          avatar_description: '',
          header_description: ''
        })
      })

      it('updates actor information and returns it in actor', async () => {
        const username = `update-actor-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({
          actorId,
          name: 'name2',
          summary: 'summary2',
          iconUrl: 'iconUrl2',
          headerImageUrl: 'headerImageUrl2',
          publicKey: 'publicKey2'
        })

        const actor = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })

        expect(actor).toMatchObject({
          id: actorId,
          username,
          domain: TEST_DOMAIN,
          account: {
            id: expect.toBeString(),
            email: `${username}@${TEST_DOMAIN}`
          },
          followersUrl: `${actorId}/followers`,
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

        const mastodonActor = await database.getMastodonActorFromId({
          id: actorId
        })
        expect(mastodonActor?.bot).toBeTrue()
      })

      it.each([
        {
          description:
            'persists true flags and attribution domains in settings',
          update: {
            indexable: true,
            hideCollections: true,
            attributionDomains: ['blog.example.com', 'news.example.com']
          }
        },
        {
          description: 'keeps persisted false flags (not treated as unset)',
          update: { indexable: false, hideCollections: false }
        }
      ])('$description', async ({ update }) => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `modern-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({ actorId, ...update })

        const settings = await database.getActorSettings({ actorId })
        expect(settings).toMatchObject(update)
      })

      it('preserves other settings updates passed alongside an append', async () => {
        const username = `append-settings-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
        expect(settings?.notificationAcceptedSenders).toEqual([
          'existing-sender',
          'new-sender'
        ])
        expect(settings?.manuallyApprovesFollowers).toBe(false)
        expect(settings?.defaultPrivacy).toBe('private')
      })

      it('persists profile appearance settings including explicit false flags', async () => {
        const username = `profile-app-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({
          actorId,
          avatarDescription: 'Coffee cup close-up',
          headerDescription: 'Mountains at dawn',
          showMedia: false,
          showMediaReplies: false,
          showFeatured: false,
          attributionDomains: ['news.example.com']
        })

        const settings = await database.getActorSettings({ actorId })
        expect(settings).toMatchObject({
          avatarDescription: 'Coffee cup close-up',
          headerDescription: 'Mountains at dawn',
          showMedia: false,
          showMediaReplies: false,
          showFeatured: false,
          attributionDomains: ['news.example.com']
        })
      })

      it('persists the profile tab flags and reads them back on the actor, false included', async () => {
        const username = `profile-tabs-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        const before = await database.getActorFromId({ id: actorId })
        expect(before?.showGallery).toBeUndefined()

        await database.updateActor({
          actorId,
          showReplies: false,
          showGallery: false,
          showFitness: true,
          showMedia: true
        })

        const actor = await database.getActorFromId({ id: actorId })
        expect(actor).toMatchObject({
          showReplies: false,
          showGallery: false,
          showFitness: true,
          showMedia: true
        })
        const settings = await database.getActorSettings({ actorId })
        expect(settings).toMatchObject({
          showReplies: false,
          showGallery: false,
          showFitness: true,
          showMedia: true
        })

        // A later save of another setting keeps the flags.
        await database.updateActor({ actorId, postLineLimit: 10 })
        const kept = await database.getActorFromId({ id: actorId })
        expect(kept?.showGallery).toBe(false)
      })

      it('clears the display name and bio with an empty string, and leaves them for undefined', async () => {
        const username = `clear-text-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)
        await database.updateActor({
          actorId,
          name: 'Some name',
          summary: 'Some bio'
        })

        await database.updateActor({ actorId, postLineLimit: 5 })
        const kept = await database.getActorFromId({ id: actorId })
        expect(kept).toMatchObject({ name: 'Some name', summary: 'Some bio' })

        await database.updateActor({ actorId, name: '', summary: '' })
        const cleared = await database.getActorFromId({ id: actorId })
        expect(cleared?.name || '').toBe('')
        expect(cleared?.summary || '').toBe('')
      })

      it('persists and returns reading preferences', async () => {
        const username = `reading-pref-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
        const username = `reading-false-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
        const username = `reading-preserve-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({ actorId, defaultPrivacy: 'unlisted' })

        await database.updateActor({ actorId, readingExpandMedia: 'hide_all' })

        const settings = await database.getActorSettings({ actorId })
        expect(settings?.defaultPrivacy).toEqual('unlisted')
        expect(settings?.readingExpandMedia).toEqual('hide_all')
      })

      it('persists and returns navigation preferences', async () => {
        const username = `nav-pref-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({
          actorId,
          navOrder: ['settings', 'timeline'],
          navHidden: ['favorites']
        })

        const settings = await database.getActorSettings({ actorId })
        expect(settings?.navOrder).toEqual(['settings', 'timeline'])
        expect(settings?.navHidden).toEqual(['favorites'])
      })

      it('round-trips an empty navigation preference as a reset', async () => {
        const username = `nav-reset-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({ actorId, navHidden: ['favorites'] })

        await database.updateActor({ actorId, navOrder: [], navHidden: [] })

        const settings = await database.getActorSettings({ actorId })
        expect(settings?.navOrder).toEqual([])
        expect(settings?.navHidden).toEqual([])
      })

      it('preserves navigation preferences when other settings change', async () => {
        const username = `nav-other-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

        await database.updateActor({ actorId, navHidden: ['bookmarks'] })

        await database.updateActor({ actorId, defaultPrivacy: 'private' })

        const settings = await database.getActorSettings({ actorId })
        expect(settings?.navHidden).toEqual(['bookmarks'])
        expect(settings?.defaultPrivacy).toEqual('private')
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
        const username = `settings-update-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
        const username = `settings-limit-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await createSigningAccount(database, username)

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
  })
})
