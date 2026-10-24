import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  EXPORT_FILES,
  csvEscape,
  exportAccountData,
  exportBlockedAccounts,
  exportBlockedDomains,
  exportBookmarks,
  exportFollowingAccounts,
  exportLists,
  exportMutedAccounts,
  isExportFileName
} from '@/lib/services/exports/accountExports'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'llun.test'

const withFreshDatabase = async (
  test: (database: Database, db: Db) => Promise<void>
) => {
  const { database, db, prepare, destroy } = createTestDatabase()
  await prepare()
  await database.migrate()
  try {
    await test(database, db)
  } finally {
    await destroy()
  }
}

const createAccount = async (
  database: Database,
  username: string,
  domain = DOMAIN
) => {
  await database.createAccount({
    email: `${username}@${domain}`,
    username,
    domain,
    passwordHash: 'test-hash',
    privateKey: `test-private-key-${username}`,
    publicKey: `test-public-key-${username}`
  })
  const actor = await database.getActorFromUsername({ username, domain })
  if (!actor) throw new Error(`Failed to create actor ${username}`)
  return actor
}

const createRemoteActor = async (
  database: Database,
  username: string,
  domain: string
) => {
  const actorId = `https://${domain}/users/${username}`
  const actor = await database.createActor({
    actorId,
    username,
    domain,
    inboxUrl: `${actorId}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    followersUrl: `${actorId}/followers`,
    publicKey: `public-key-${username}`,
    createdAt: Date.now()
  })
  if (!actor) throw new Error(`Failed to create remote actor ${username}`)
  return actor
}

describe('accountExports', () => {
  describe('isExportFileName', () => {
    it('recognizes valid export filenames and rejects unknown ones', () => {
      for (const file of EXPORT_FILES) {
        expect(isExportFileName(file)).toBe(true)
      }
      expect(isExportFileName('followers.csv')).toBe(false)
      expect(isExportFileName('posts.csv')).toBe(false)
      expect(isExportFileName('')).toBe(false)
    })
  })

  describe('csvEscape', () => {
    it('leaves plain text unescaped', () => {
      expect(csvEscape('alice@example.test')).toBe('alice@example.test')
      expect(csvEscape('plain text')).toBe('plain text')
    })

    it('quotes and escapes commas, quotes, and newlines', () => {
      expect(csvEscape('a,b')).toBe('"a,b"')
      expect(csvEscape('a"b')).toBe('"a""b"')
      expect(csvEscape('a\nb')).toBe('"a\nb"')
      expect(csvEscape('a\r\nb')).toBe('"a\r\nb"')
      expect(csvEscape('"nested" and "quotes", here')).toBe(
        '"""nested"" and ""quotes"", here"'
      )
    })
  })

  describe('following_accounts.csv', () => {
    it('exports following accounts with header, languages formatting, and excludes follow requests', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const target1 = await createRemoteActor(
          database,
          'alice',
          'remote1.test'
        )
        const target2 = await createRemoteActor(database, 'bob', 'remote2.test')
        const pending = await createRemoteActor(
          database,
          'charlie',
          'remote3.test'
        )

        // Accepted follow with no languages
        await database.createFollow({
          id: 'follow-1',
          actorId: owner.id,
          targetActorId: target1.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${target1.id}/inbox`,
          sharedInbox: `${target1.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })

        // Accepted follow with multiple languages
        await database.createFollow({
          id: 'follow-2',
          actorId: owner.id,
          targetActorId: target2.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${target2.id}/inbox`,
          sharedInbox: `${target2.id}/inbox`,
          reblogs: false,
          notify: true,
          languages: ['en', 'fr']
        })

        // Requested follow (pending request) - must be excluded
        await database.createFollow({
          id: 'follow-3',
          actorId: owner.id,
          targetActorId: pending.id,
          status: FollowStatus.enum.Requested,
          inbox: `${pending.id}/inbox`,
          sharedInbox: `${pending.id}/inbox`
        })

        const csv = await exportFollowingAccounts(database, owner.id)
        expect(csv).toBe(
          'Account address,Show boosts,Notify on new posts,Languages\n' +
            'bob@remote2.test,false,true,"en, fr"\n' +
            'alice@remote1.test,true,false,\n'
        )
      })
    })
  })

  describe('lists.csv', () => {
    it('exports lists without header and properly escapes list titles with commas and quotes', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const member = await createRemoteActor(
          database,
          'member',
          'remote.test'
        )

        const list = await database.createList({
          actorId: owner.id,
          title: 'Tech, "Special"'
        })
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })

        const csv = await exportLists(database, owner.id)
        expect(csv).toBe('"Tech, ""Special""",member@remote.test\n')
      })
    })
  })

  describe('muted_accounts.csv', () => {
    it('exports muted accounts with header, hide_notifications, and excludes expired mutes', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const target1 = await createRemoteActor(
          database,
          'mute1',
          'remote1.test'
        )
        const target2 = await createRemoteActor(
          database,
          'mute2',
          'remote2.test'
        )
        const target3 = await createRemoteActor(
          database,
          'mute3',
          'remote3.test'
        )

        // Active mute with hide notifications = true
        await database.createMute({
          actorId: owner.id,
          targetActorId: target1.id,
          notifications: true,
          endsAt: null
        })
        await new Promise((resolve) => setTimeout(resolve, 10))

        // Active mute with hide notifications = false
        await database.createMute({
          actorId: owner.id,
          targetActorId: target2.id,
          notifications: false,
          endsAt: Date.now() + 100_000
        })

        // Expired mute - must be excluded
        await database.createMute({
          actorId: owner.id,
          targetActorId: target3.id,
          notifications: true,
          endsAt: Date.now() - 100_000
        })

        const csv = await exportMutedAccounts(database, owner.id)
        expect(csv).toBe(
          'Account address,Hide notifications\n' +
            'mute2@remote2.test,false\n' +
            'mute1@remote1.test,true\n'
        )
      })
    })
  })

  describe('blocked_accounts.csv', () => {
    it('exports blocked accounts without header', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const target = await createRemoteActor(
          database,
          'badactor',
          'remote.test'
        )

        await database.createBlock({
          actorId: owner.id,
          targetActorId: target.id,
          uri: `${owner.id}/blocks/1`
        })

        const csv = await exportBlockedAccounts(database, owner.id)
        expect(csv).toBe('badactor@remote.test\n')
      })
    })
  })

  describe('blocked_domains.csv', () => {
    it('exports blocked domains without header', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')

        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'spammer.social'
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'botnet.org'
        })

        const csv = await exportBlockedDomains(database, owner.id)
        expect(csv).toBe('botnet.org\nspammer.social\n')
      })
    })
  })

  describe('bookmarks.csv', () => {
    it('exports bookmarks without header using canonical ActivityPub URI and skips nonexistent statuses', async () => {
      await withFreshDatabase(async (database, db) => {
        const owner = await createAccount(database, 'owner')
        const author = await createAccount(database, 'author')

        const statusId = `${author.id}/statuses/1`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: author.id,
          text: 'bookmarkable note',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        // Real bookmark with existing status
        await database.createBookmark({
          actorId: owner.id,
          statusId
        })

        // Orphaned bookmark whose status does not exist
        await db
          .insertInto('bookmarks')
          .values({
            actorId: owner.id,
            statusId: 'https://llun.test/statuses/ghost',
            createdAt: new Date(),
            updatedAt: new Date()
          })
          .execute()

        const csv = await exportBookmarks(database, owner.id)
        expect(csv).toBe(`${statusId}\n`)
      })
    })
  })

  describe('missing target actor handling', () => {
    it('drops rows when target actor cannot be resolved', async () => {
      await withFreshDatabase(async (database, db) => {
        const owner = await createAccount(database, 'owner')
        const missingActor = await createRemoteActor(
          database,
          'vanished',
          'remote.test'
        )

        await database.createFollow({
          id: 'follow-missing',
          actorId: owner.id,
          targetActorId: missingActor.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${missingActor.id}/inbox`,
          sharedInbox: `${missingActor.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })

        const list = await database.createList({
          actorId: owner.id,
          title: 'List with missing member'
        })
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [missingActor.id]
        })

        await database.createMute({
          actorId: owner.id,
          targetActorId: missingActor.id,
          notifications: true,
          endsAt: null
        })

        await database.createBlock({
          actorId: owner.id,
          targetActorId: missingActor.id,
          uri: `${owner.id}/blocks/2`
        })

        // Delete the actor row to simulate foreign/deleted actor
        await db
          .deleteFrom('actors')
          .where('id', '=', missingActor.id)
          .execute()

        expect(await exportFollowingAccounts(database, owner.id)).toBe(
          'Account address,Show boosts,Notify on new posts,Languages\n'
        )
        expect(await exportLists(database, owner.id)).toBe('')
        expect(await exportMutedAccounts(database, owner.id)).toBe(
          'Account address,Hide notifications\n'
        )
        expect(await exportBlockedAccounts(database, owner.id)).toBe('')
      })
    })
  })

  describe('empty exports', () => {
    it('returns header-only for following and muted, and empty string for others', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')

        expect(
          await exportAccountData('following_accounts.csv', database, owner.id)
        ).toBe('Account address,Show boosts,Notify on new posts,Languages\n')

        expect(
          await exportAccountData('muted_accounts.csv', database, owner.id)
        ).toBe('Account address,Hide notifications\n')

        expect(await exportAccountData('lists.csv', database, owner.id)).toBe(
          ''
        )

        expect(
          await exportAccountData('blocked_accounts.csv', database, owner.id)
        ).toBe('')

        expect(
          await exportAccountData('blocked_domains.csv', database, owner.id)
        ).toBe('')

        expect(
          await exportAccountData('bookmarks.csv', database, owner.id)
        ).toBe('')
      })
    })
  })

  describe('pagination proof', () => {
    it('properly pages through 3+ items with pageSize = 1', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const t1 = await createRemoteActor(database, 'target1', 'remote1.test')
        const t2 = await createRemoteActor(database, 'target2', 'remote2.test')
        const t3 = await createRemoteActor(database, 'target3', 'remote3.test')

        await database.createFollow({
          id: 'follow-1',
          actorId: owner.id,
          targetActorId: t1.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${t1.id}/inbox`,
          sharedInbox: `${t1.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })
        await database.createFollow({
          id: 'follow-2',
          actorId: owner.id,
          targetActorId: t2.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${t2.id}/inbox`,
          sharedInbox: `${t2.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })
        await database.createFollow({
          id: 'follow-3',
          actorId: owner.id,
          targetActorId: t3.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${t3.id}/inbox`,
          sharedInbox: `${t3.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })

        // Export with pageSize: 1 should return all 3 rows across 3 pages
        const csv = await exportFollowingAccounts(database, owner.id, {
          pageSize: 1
        })
        expect(csv).toBe(
          'Account address,Show boosts,Notify on new posts,Languages\n' +
            'target3@remote3.test,true,false,\n' +
            'target2@remote2.test,true,false,\n' +
            'target1@remote1.test,true,false,\n'
        )

        // Same for exportBlockedDomains with pageSize: 1
        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'domain1.test'
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'domain2.test'
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'domain3.test'
        })

        const domainCsv = await exportBlockedDomains(database, owner.id, {
          pageSize: 1
        })
        expect(domainCsv).toBe('domain3.test\ndomain2.test\ndomain1.test\n')
      })
    })

    it('pages through list members across multiple lists with pageSize = 1', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const m1 = await createRemoteActor(database, 'm1', 'remote.test')
        const m2 = await createRemoteActor(database, 'm2', 'remote.test')

        const list1 = await database.createList({
          actorId: owner.id,
          title: 'List 1'
        })
        await database.addListAccounts({
          listId: list1.id,
          actorId: owner.id,
          targetActorIds: [m1.id]
        })

        const list2 = await database.createList({
          actorId: owner.id,
          title: 'List 2'
        })
        await database.addListAccounts({
          listId: list2.id,
          actorId: owner.id,
          targetActorIds: [m2.id]
        })

        const listCsv = await exportLists(database, owner.id, { pageSize: 1 })
        expect(listCsv).toBe(
          'List 1,m1@remote.test\n' + 'List 2,m2@remote.test\n'
        )
      })
    })
  })

  describe('exportAccountData dispatcher', () => {
    it('dispatches properly to each export handler for all EXPORT_FILES', async () => {
      await withFreshDatabase(async (database) => {
        const owner = await createAccount(database, 'owner')
        const target = await createRemoteActor(
          database,
          'target',
          'remote.test'
        )

        await database.createFollow({
          id: 'f1',
          actorId: owner.id,
          targetActorId: target.id,
          status: FollowStatus.enum.Accepted,
          inbox: `${target.id}/inbox`,
          sharedInbox: `${target.id}/inbox`,
          reblogs: true,
          notify: false,
          languages: null
        })

        const list = await database.createList({
          actorId: owner.id,
          title: 'My List'
        })
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [target.id]
        })

        await database.createMute({
          actorId: owner.id,
          targetActorId: target.id,
          notifications: true,
          endsAt: null
        })

        await database.createBlock({
          actorId: owner.id,
          targetActorId: target.id,
          uri: `${owner.id}/b/1`
        })

        await database.createActorDomainBlock({
          actorId: owner.id,
          domain: 'blocked.test'
        })

        const statusId = `${target.id}/statuses/1`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: target.id,
          text: 'note',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.createBookmark({
          actorId: owner.id,
          statusId
        })

        expect(
          await exportAccountData('following_accounts.csv', database, owner.id)
        ).toBe(
          'Account address,Show boosts,Notify on new posts,Languages\n' +
            'target@remote.test,true,false,\n'
        )

        expect(await exportAccountData('lists.csv', database, owner.id)).toBe(
          'My List,target@remote.test\n'
        )

        expect(
          await exportAccountData('muted_accounts.csv', database, owner.id)
        ).toBe('Account address,Hide notifications\ntarget@remote.test,true\n')

        expect(
          await exportAccountData('blocked_accounts.csv', database, owner.id)
        ).toBe('target@remote.test\n')

        expect(
          await exportAccountData('blocked_domains.csv', database, owner.id)
        ).toBe('blocked.test\n')

        expect(
          await exportAccountData('bookmarks.csv', database, owner.id)
        ).toBe(`${statusId}\n`)
      })
    })
  })
})
