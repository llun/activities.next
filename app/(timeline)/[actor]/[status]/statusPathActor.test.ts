import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { statusMatchesPathActor } from './statusPathActor'

const ALICE_ID = 'https://activities.local/users/alice'
const ALICE_TWIN_ID = 'https://activities.local/users/Alice'
const BOOSTER_ID = 'https://activities.local/users/booster'

const buildNote = (overrides: Record<string, unknown> = {}): StatusNote =>
  ({
    id: `${ALICE_ID}/statuses/note-id`,
    type: StatusType.enum.Note,
    actorId: ALICE_ID,
    actor: null,
    url: `${ALICE_ID}/statuses/note-id`,
    text: 'body',
    reply: '',
    replies: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    isActorLiked: false,
    isActorBookmarked: false,
    actorAnnounceStatusId: null,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as unknown as StatusNote

const buildAnnounce = (originalStatus: Status): Status =>
  ({
    id: `${BOOSTER_ID}/statuses/boost`,
    type: StatusType.enum.Announce,
    actorId: BOOSTER_ID,
    actor: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: 1,
    updatedAt: 1,
    originalStatus
  }) as unknown as Status

// The path actor's stored row, or null when the handle is not stored here.
const databaseWith = (row: { id: string } | null) =>
  ({
    getActorFromUsername: vi.fn(async () => row)
  }) as never

// Emulates `getActorFromUsername`'s real order — exact, then the handle ledger,
// then the folded actors row — so a test can tell which spelling a lookup used.
// The domain is matched exactly, as the actors arms do.
const databaseWithActors = ({
  actors,
  ledger = {}
}: {
  actors: Array<{ id: string; username: string; domain: string }>
  ledger?: Record<string, string>
}) =>
  ({
    getActorFromUsername: vi.fn(
      async ({ username, domain }: { username: string; domain: string }) => {
        const exact = actors.find(
          (actor) => actor.username === username && actor.domain === domain
        )
        if (exact) return exact

        const ledgerId =
          ledger[`${username.toLowerCase()}@${domain.toLowerCase()}`]
        if (ledgerId) {
          return (
            actors.find((actor) => actor.id === ledgerId) ?? { id: ledgerId }
          )
        }

        return (
          actors
            .filter(
              (actor) =>
                actor.username.toLowerCase() === username.toLowerCase() &&
                actor.domain === domain
            )
            .sort((left, right) => (left.id < right.id ? -1 : 1))[0] ?? null
        )
      }
    )
  }) as never

describe('statusMatchesPathActor', () => {
  it('accepts a status whose actor id is the path actor stored id', async () => {
    await expect(
      statusMatchesPathActor({
        database: databaseWith({ id: ALICE_ID }),
        status: buildNote(),
        pathActor: { username: 'alice', domain: 'activities.local' }
      })
    ).resolves.toBe(true)
  })

  it('rejects a case-variant twin status under the other account path', async () => {
    // `Alice` and `alice` are distinct accounts on an instance that minted
    // before usernames were normalized. The handles fold to the same string, so
    // only the stored ids can tell them apart.
    await expect(
      statusMatchesPathActor({
        database: databaseWith({ id: ALICE_ID }),
        status: buildNote({
          actorId: ALICE_TWIN_ID,
          actor: { username: 'Alice', domain: 'activities.local' }
        }),
        pathActor: { username: 'alice', domain: 'activities.local' }
      })
    ).resolves.toBe(false)
  })

  it('accepts a renamed actor status under the handle it gave up', async () => {
    // The handle ledger resolves the retired handle to the same actor, so the
    // stored id matches even though the status carries the new handle.
    await expect(
      statusMatchesPathActor({
        database: databaseWith({ id: ALICE_ID }),
        status: buildNote({
          actor: { username: 'alice-renamed', domain: 'activities.local' }
        }),
        pathActor: { username: 'alice', domain: 'activities.local' }
      })
    ).resolves.toBe(true)
  })

  it('falls back to the verified handle when the path actor is not stored', async () => {
    await expect(
      statusMatchesPathActor({
        database: databaseWith(null),
        status: buildNote({
          actorId: 'https://remote.example/users/bob',
          actor: { username: 'bob', domain: 'remote.example' }
        }),
        pathActor: { username: 'bob', domain: 'remote.example' }
      })
    ).resolves.toBe(true)
  })

  it('rejects a foreign author when the path actor is not stored', async () => {
    await expect(
      statusMatchesPathActor({
        database: databaseWith(null),
        status: buildNote({
          actorId: 'https://remote.example/users/bob',
          actor: { username: 'bob', domain: 'remote.example' }
        }),
        pathActor: { username: 'alice', domain: 'remote.example' }
      })
    ).resolves.toBe(false)
  })

  it('accepts a boost under the boosted author stored id', async () => {
    await expect(
      statusMatchesPathActor({
        database: databaseWith({ id: ALICE_ID }),
        status: buildAnnounce(buildNote()),
        pathActor: { username: 'alice', domain: 'activities.local' }
      })
    ).resolves.toBe(true)
  })

  it('resolves a case-variant path domain to the exact handle, not a case twin', async () => {
    // The stored domain is lowercase; the path spells it uppercase. The
    // exact-username arm must still win over the ledger's folded twin, so the
    // `Alice` post is accepted under `@Alice@ACTIVITIES.LOCAL`.
    await expect(
      statusMatchesPathActor({
        database: databaseWithActors({
          actors: [
            { id: ALICE_ID, username: 'alice', domain: 'activities.local' },
            { id: ALICE_TWIN_ID, username: 'Alice', domain: 'activities.local' }
          ],
          ledger: { 'alice@activities.local': ALICE_ID }
        }),
        status: buildNote({
          actorId: ALICE_TWIN_ID,
          actor: { username: 'Alice', domain: 'activities.local' }
        }),
        pathActor: { username: 'Alice', domain: 'ACTIVITIES.LOCAL' }
      })
    ).resolves.toBe(true)
  })

  it('finds a stored remote actor through a case-variant path domain', async () => {
    // A stored row without its actor hydrated leaves only the id comparison, so
    // the lookup has to find the row even though the path spells the domain in
    // another case.
    await expect(
      statusMatchesPathActor({
        database: databaseWithActors({
          actors: [
            {
              id: 'https://remote.example/users/bob',
              username: 'bob',
              domain: 'remote.example'
            }
          ]
        }),
        status: buildNote({
          actorId: 'https://remote.example/users/bob',
          actor: null
        }),
        pathActor: { username: 'bob', domain: 'REMOTE.EXAMPLE' }
      })
    ).resolves.toBe(true)
  })
})
