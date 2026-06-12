import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'

const ACTOR1_ID = 'https://suggestions.test/users/actor1'
const ACTOR_A_ID = 'https://suggestions.test/users/actorA'
const ACTOR_B_ID = 'https://suggestions.test/users/actorB'
const ACTOR_C_ID = 'https://suggestions.test/users/actorC'
const ACTOR_D_ID = 'https://suggestions.test/users/actorD'
const ACTOR_E_ID = 'https://suggestions.test/users/actorE'
const ACTOR_F_ID = 'https://suggestions.test/users/actorF'

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

const createFollow = (
  database: Database,
  actorId: string,
  targetActorId: string,
  status: FollowStatus = FollowStatus.enum.Accepted
) =>
  database.createFollow({
    actorId,
    targetActorId,
    status,
    inbox: `${actorId}/inbox`,
    sharedInbox: 'https://suggestions.test/inbox'
  })

// actor1 follows A and B; A and B both follow C; A also follows D and
// follows actor1 back (a mutual), making actor1 its own second-hop
// candidate unless the query excludes the querying actor. All edges are
// Accepted, so for actor1 the friends-of-friends candidates are
// C (2 mutuals) and D (1 mutual).
const seedFriendGraph = async (database: Database) => {
  await createFollow(database, ACTOR1_ID, ACTOR_A_ID)
  await createFollow(database, ACTOR1_ID, ACTOR_B_ID)
  await createFollow(database, ACTOR_A_ID, ACTOR_C_ID)
  await createFollow(database, ACTOR_B_ID, ACTOR_C_ID)
  await createFollow(database, ACTOR_A_ID, ACTOR_D_ID)
  await createFollow(database, ACTOR_A_ID, ACTOR1_ID)
}

describe('getFriendsOfFriendsSuggestions', () => {
  it('ranks accounts followed by followed accounts by mutual count descending', async () => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)

      const suggestions = await database.getFriendsOfFriendsSuggestions({
        actorId: ACTOR1_ID,
        limit: 10
      })
      expect(suggestions).toEqual([
        { targetActorId: ACTOR_C_ID, mutuals: 2 },
        { targetActorId: ACTOR_D_ID, mutuals: 1 }
      ])
    })
  })

  it.each([
    {
      description: 'ignores a pending second-hop edge when counting mutuals',
      extraFollows: [
        [ACTOR_B_ID, ACTOR_D_ID, FollowStatus.enum.Requested] as const
      ],
      expected: [
        { targetActorId: ACTOR_C_ID, mutuals: 2 },
        { targetActorId: ACTOR_D_ID, mutuals: 1 }
      ]
    },
    {
      description:
        'ignores a pending first-hop edge and its accepted continuation',
      extraFollows: [
        [ACTOR1_ID, ACTOR_E_ID, FollowStatus.enum.Requested] as const,
        [ACTOR_E_ID, ACTOR_F_ID, FollowStatus.enum.Accepted] as const
      ],
      expected: [
        { targetActorId: ACTOR_C_ID, mutuals: 2 },
        { targetActorId: ACTOR_D_ID, mutuals: 1 }
      ]
    },
    {
      description:
        'excludes a candidate the actor already has a pending follow request to',
      extraFollows: [
        [ACTOR1_ID, ACTOR_D_ID, FollowStatus.enum.Requested] as const
      ],
      expected: [{ targetActorId: ACTOR_C_ID, mutuals: 2 }]
    }
  ])('$description', async ({ extraFollows, expected }) => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)
      for (const [actorId, targetActorId, status] of extraFollows) {
        await createFollow(database, actorId, targetActorId, status)
      }

      const suggestions = await database.getFriendsOfFriendsSuggestions({
        actorId: ACTOR1_ID,
        limit: 10
      })
      expect(suggestions).toEqual(expected)
    })
  })

  it('excludes dismissed accounts and accounts the actor now follows', async () => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)

      await database.dismissSuggestion({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR_C_ID
      })
      expect(
        await database.getFriendsOfFriendsSuggestions({
          actorId: ACTOR1_ID,
          limit: 10
        })
      ).toEqual([{ targetActorId: ACTOR_D_ID, mutuals: 1 }])

      await createFollow(database, ACTOR1_ID, ACTOR_D_ID)
      expect(
        await database.getFriendsOfFriendsSuggestions({
          actorId: ACTOR1_ID,
          limit: 10
        })
      ).toEqual([])
    })
  })

  it.each([
    {
      description: 'excludes a candidate the actor blocks',
      block: [ACTOR1_ID, ACTOR_C_ID] as const
    },
    {
      description: 'excludes a candidate that blocks the actor',
      block: [ACTOR_C_ID, ACTOR1_ID] as const
    }
  ])('$description', async ({ block }) => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)

      const [blockActorId, blockTargetActorId] = block
      await database.createBlock({
        actorId: blockActorId,
        targetActorId: blockTargetActorId,
        uri: `${blockActorId}#blocks/1`
      })

      expect(
        await database.getFriendsOfFriendsSuggestions({
          actorId: ACTOR1_ID,
          limit: 10
        })
      ).toEqual([{ targetActorId: ACTOR_D_ID, mutuals: 1 }])
    })
  })

  it('excludes an actively muted candidate but keeps an expired mute suggestable', async () => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)

      // Active mute on C hides it; an expired mute on D leaves it suggestable.
      await database.createMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR_C_ID,
        notifications: false,
        endsAt: null
      })
      await database.createMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR_D_ID,
        notifications: false,
        endsAt: Date.now() - 1000
      })

      expect(
        await database.getFriendsOfFriendsSuggestions({
          actorId: ACTOR1_ID,
          limit: 10
        })
      ).toEqual([{ targetActorId: ACTOR_D_ID, mutuals: 1 }])
    })
  })

  it('returns only the highest ranked accounts when limit is smaller than the candidate count', async () => {
    await withFreshDatabase(async (database) => {
      await seedFriendGraph(database)

      const suggestions = await database.getFriendsOfFriendsSuggestions({
        actorId: ACTOR1_ID,
        limit: 1
      })
      expect(suggestions).toEqual([{ targetActorId: ACTOR_C_ID, mutuals: 2 }])
    })
  })
})

describe('dismissSuggestion', () => {
  it('does not throw when the same pair is dismissed twice', async () => {
    await withFreshDatabase(async (database) => {
      await database.dismissSuggestion({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR_C_ID
      })
      await expect(
        database.dismissSuggestion({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR_C_ID
        })
      ).resolves.toBeUndefined()
    })
  })
})
