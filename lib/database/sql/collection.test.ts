import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

const createLocalAccount = (database: Database, username: string) =>
  database.createAccount({
    email: `${username}@${TEST_DOMAIN}`,
    username,
    passwordHash: 'hash',
    domain: TEST_DOMAIN,
    privateKey: `privateKey-${username}`,
    publicKey: `publicKey-${username}`
  })

const actor = async (database: Database, username: string) => {
  const found = await database.getActorFromUsername({
    username,
    domain: TEST_DOMAIN
  })
  if (!found) throw new Error(`${username} not created`)
  return found
}

const publicNote = (
  database: Database,
  actorId: string,
  localId: string,
  reply = ''
) => {
  const id = `${actorId}/statuses/${localId}`
  return database.createNote({
    id,
    url: id,
    actorId,
    text: 'note',
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply
  })
}

const followersOnlyNote = (
  database: Database,
  actorId: string,
  localId: string
) => {
  const id = `${actorId}/statuses/${localId}`
  return database.createNote({
    id,
    url: id,
    actorId,
    text: 'followers only',
    to: [`${actorId}/followers`],
    cc: [],
    reply: ''
  })
}

describe('CollectionDatabase', () => {
  describe('CRUD', () => {
    it('creates, reads, lists, updates and deletes a collection', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'owner')
        const owner = await actor(database, 'owner')

        const created = await database.createCollection({
          actorId: owner.id,
          title: 'Cool people',
          description: 'A bundle',
          topic: 'fediverse',
          language: 'en'
        })
        expect(created.title).toBe('Cool people')
        expect(created.description).toBe('A bundle')
        expect(created.topic).toBe('fediverse')
        // Defaults: feed on, public visibility.
        expect(created.visibility).toBe('public')
        expect(created.publicFeed).toBe(true)

        const fetched = await database.getCollection({
          id: created.id,
          actorId: owner.id
        })
        expect(fetched?.id).toBe(created.id)

        await database.createCollection({ actorId: owner.id, title: 'Second' })
        const all = await database.getCollections({ actorId: owner.id })
        expect(all.map((c) => c.title)).toEqual(['Cool people', 'Second'])

        const updated = await database.updateCollection({
          id: created.id,
          actorId: owner.id,
          title: 'Renamed',
          publicFeed: false
        })
        expect(updated?.title).toBe('Renamed')
        expect(updated?.publicFeed).toBe(false)

        expect(
          await database.deleteCollection({ id: created.id, actorId: owner.id })
        ).toBe(true)
        expect(
          await database.getCollection({ id: created.id, actorId: owner.id })
        ).toBeNull()
      })
    })

    it('scopes reads and mutations to the owner', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'owner')
        await createLocalAccount(database, 'other')
        const owner = await actor(database, 'owner')
        const other = await actor(database, 'other')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Mine'
        })

        // Another actor cannot read it, update it, or delete it.
        expect(
          await database.getCollection({ id: collection.id, actorId: other.id })
        ).toBeNull()
        expect(
          await database.updateCollection({
            id: collection.id,
            actorId: other.id,
            title: 'Hijacked'
          })
        ).toBeNull()
        expect(
          await database.deleteCollection({
            id: collection.id,
            actorId: other.id
          })
        ).toBe(false)

        // Still intact for the owner.
        const stillThere = await database.getCollection({
          id: collection.id,
          actorId: owner.id
        })
        expect(stillThere?.title).toBe('Mine')
      })
    })
  })

  describe('membership', () => {
    it('adds members (pending), counts, and removes them', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'alice', 'bob']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const alice = await actor(database, 'alice')
        const bob = await actor(database, 'bob')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'People'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [alice.id, bob.id]
        })
        // Idempotent re-add.
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [alice.id]
        })

        const ownerView = await database.getCollectionMembers({
          id: collection.id,
          actorId: owner.id
        })
        expect(ownerView.accounts).toHaveLength(2)

        const counts = await database.getCollectionMemberCounts({
          actorId: owner.id,
          collectionIds: [collection.id]
        })
        expect(counts[collection.id]).toBe(2)

        await database.removeCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [alice.id]
        })
        const afterRemove = await database.getCollectionMembers({
          id: collection.id,
          actorId: owner.id
        })
        expect(afterRemove.accounts).toHaveLength(1)
      })
    })

    it('exposes only approved members in the public projection', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'alice', 'bob']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const alice = await actor(database, 'alice')
        const bob = await actor(database, 'bob')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'People'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [alice.id, bob.id]
        })

        // Both pending → public projection empty.
        const publicBefore = await database.getCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          projection: 'public'
        })
        expect(publicBefore.accounts).toHaveLength(0)

        // Approve alice only.
        await database.setCollectionMemberState({
          id: collection.id,
          actorId: owner.id,
          targetActorId: alice.id,
          state: 'approved'
        })
        const publicAfter = await database.getCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          projection: 'public'
        })
        // Only the approved member (alice) is exposed publicly; bob is hidden.
        expect(publicAfter.accounts).toHaveLength(1)
        expect(publicAfter.accounts[0].username).toBe('alice')

        const approvedCounts = await database.getCollectionMemberCounts({
          actorId: owner.id,
          collectionIds: [collection.id],
          approvedOnly: true
        })
        expect(approvedCounts[collection.id]).toBe(1)
      })
    })

    it('returns only approved members with their actor type (for the AP representation)', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'alice', 'bob']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const alice = await actor(database, 'alice')
        const bob = await actor(database, 'bob')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'People'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [alice.id, bob.id]
        })
        // Pending → nothing federated yet.
        expect(
          await database.getApprovedCollectionMembers({
            id: collection.id,
            actorId: owner.id
          })
        ).toEqual([])

        await database.setCollectionMemberState({
          id: collection.id,
          actorId: owner.id,
          targetActorId: bob.id,
          state: 'approved'
        })
        // Approved member is returned with its resolved actor type.
        expect(
          await database.getApprovedCollectionMembers({
            id: collection.id,
            actorId: owner.id
          })
        ).toEqual([{ id: bob.id, type: 'Person' }])

        // Not owned by another actor → empty (owner-scoped).
        expect(
          await database.getApprovedCollectionMembers({
            id: collection.id,
            actorId: alice.id
          })
        ).toEqual([])
      })
    })

    it('lists collections that contain a given account', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'alice']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const alice = await actor(database, 'alice')

        const a = await database.createCollection({
          actorId: owner.id,
          title: 'A'
        })
        const b = await database.createCollection({
          actorId: owner.id,
          title: 'B'
        })
        await database.addCollectionMembers({
          id: a.id,
          actorId: owner.id,
          targetActorIds: [alice.id]
        })

        const withAlice = await database.getCollectionsWithAccount({
          actorId: owner.id,
          targetActorId: alice.id
        })
        expect(withAlice.map((c) => c.id)).toEqual([a.id])
        expect(withAlice.map((c) => c.id)).not.toContain(b.id)
      })
    })
  })

  describe('timeline', () => {
    it('fans new posts into the feed and backfills history on add', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'member']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const member = await actor(database, 'member')

        // A post that exists BEFORE the member is added (tests backfill).
        const before = await publicNote(database, member.id, 'before')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Feed'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })

        // A post AFTER the add (tests fan-out).
        const after = await publicNote(database, member.id, 'after')
        await database.addStatusToCollectionTimelines({ status: after })

        const ownerFeed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id
        })
        const ids = ownerFeed.map((s) => s.id)
        expect(ids).toContain(before.id)
        expect(ids).toContain(after.id)
        // Newest first.
        expect(ids.indexOf(after.id)).toBeLessThan(ids.indexOf(before.id))
      })
    })

    it('never leaks followers-only posts into the public feed', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'member']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const member = await actor(database, 'member')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Feed'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })
        // Member must be approved to appear in the public projection at all.
        await database.setCollectionMemberState({
          id: collection.id,
          actorId: owner.id,
          targetActorId: member.id,
          state: 'approved'
        })

        const publicPost = await publicNote(database, member.id, 'pub')
        const followersPost = await followersOnlyNote(
          database,
          member.id,
          'foll'
        )
        await database.addStatusToCollectionTimelines({ status: publicPost })
        await database.addStatusToCollectionTimelines({ status: followersPost })

        // Owner private projection: both posts visible (owner authored neither,
        // but as the curator they see the materialized feed for all members).
        const ownerFeed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id
        })
        expect(ownerFeed.map((s) => s.id)).toContain(publicPost.id)

        // Public projection: only the public post, never the followers-only one.
        const publicFeed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id,
          projection: 'public'
        })
        const publicIds = publicFeed.map((s) => s.id)
        expect(publicIds).toContain(publicPost.id)
        expect(publicIds).not.toContain(followersPost.id)
      })
    })

    it('hides unapproved members from the public feed but keeps them for the owner', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'member']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const member = await actor(database, 'member')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Feed'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })

        const post = await publicNote(database, member.id, 'pub')
        await database.addStatusToCollectionTimelines({ status: post })

        // Member is still pending → owner sees the post, public does not.
        const ownerFeed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id
        })
        expect(ownerFeed.map((s) => s.id)).toContain(post.id)

        const publicFeed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id,
          projection: 'public'
        })
        expect(publicFeed.map((s) => s.id)).not.toContain(post.id)
      })
    })

    it('drops a removed member’s posts from the feed', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'member']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const member = await actor(database, 'member')

        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Feed'
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })
        const post = await publicNote(database, member.id, 'pub')
        await database.addStatusToCollectionTimelines({ status: post })

        await database.removeCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })
        const feed = await database.getCollectionTimeline({
          id: collection.id,
          actorId: owner.id
        })
        expect(feed.map((s) => s.id)).not.toContain(post.id)
      })
    })
  })

  describe('public feed', () => {
    const setup = async (
      database: Database,
      visibility: 'public' | 'unlisted' | 'private',
      publicFeed: boolean
    ) => {
      for (const name of ['owner', 'member']) {
        await createLocalAccount(database, name)
      }
      const owner = await actor(database, 'owner')
      const member = await actor(database, 'member')
      const collection = await database.createCollection({
        actorId: owner.id,
        title: 'Feed',
        visibility,
        publicFeed
      })
      await database.addCollectionMembers({
        id: collection.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      await database.setCollectionMemberState({
        id: collection.id,
        actorId: owner.id,
        targetActorId: member.id,
        state: 'approved'
      })
      const pub = await publicNote(database, member.id, 'pub')
      const foll = await followersOnlyNote(database, member.id, 'foll')
      await database.addStatusToCollectionTimelines({ status: pub })
      await database.addStatusToCollectionTimelines({ status: foll })
      return { collection, pub, foll }
    }

    it('serves approved, public-only posts for a public collection', async () => {
      await withFreshDatabase(async (database) => {
        const { collection, pub, foll } = await setup(database, 'public', true)
        const feed = await database.getPublicCollectionTimeline({
          id: collection.id
        })
        expect(feed).not.toBeNull()
        const ids = feed!.map((s) => s.id)
        expect(ids).toContain(pub.id)
        expect(ids).not.toContain(foll.id)
      })
    })

    it('returns null for a private collection', async () => {
      await withFreshDatabase(async (database) => {
        const { collection } = await setup(database, 'private', true)
        expect(
          await database.getPublicCollectionTimeline({ id: collection.id })
        ).toBeNull()
      })
    })

    it('returns null when the feed is disabled', async () => {
      await withFreshDatabase(async (database) => {
        const { collection } = await setup(database, 'public', false)
        expect(
          await database.getPublicCollectionTimeline({ id: collection.id })
        ).toBeNull()
      })
    })

    it('hides unapproved members from the public feed', async () => {
      await withFreshDatabase(async (database) => {
        for (const name of ['owner', 'pending']) {
          await createLocalAccount(database, name)
        }
        const owner = await actor(database, 'owner')
        const pending = await actor(database, 'pending')
        const collection = await database.createCollection({
          actorId: owner.id,
          title: 'Feed',
          visibility: 'public',
          publicFeed: true
        })
        await database.addCollectionMembers({
          id: collection.id,
          actorId: owner.id,
          targetActorIds: [pending.id]
        })
        const post = await publicNote(database, pending.id, 'pub')
        await database.addStatusToCollectionTimelines({ status: post })

        const feed = await database.getPublicCollectionTimeline({
          id: collection.id
        })
        expect(feed).not.toBeNull()
        expect(feed!.map((s) => s.id)).not.toContain(post.id)
      })
    })
  })
})
