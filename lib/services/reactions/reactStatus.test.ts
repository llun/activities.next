import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  reactStatus,
  unreactStatus
} from '@/lib/services/reactions/reactStatus'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const mockSendReaction = vi.fn()
const mockSendUndoReaction = vi.fn()

vi.mock('@/lib/activities', () => ({
  sendReaction: (...params: unknown[]) => mockSendReaction(...params),
  sendUndoReaction: (...params: unknown[]) => mockSendUndoReaction(...params)
}))

describe('reactStatus', () => {
  const database = getTestSQLDatabase()
  let reactor: Actor
  let author: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    reactor = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
    author = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    await database.createCustomEmoji({
      shortcode: 'partyparrot',
      url: 'https://test.llun.dev/emojis/partyparrot.gif',
      staticUrl: 'https://test.llun.dev/emojis/partyparrot.png'
    })
    await database.createCustomEmoji({
      shortcode: 'retired',
      url: 'https://test.llun.dev/emojis/retired.gif',
      staticUrl: 'https://test.llun.dev/emojis/retired.png',
      disabled: true
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores a unicode reaction and reports the change', async () => {
    const statusId = `${ACTOR1_ID}/statuses/post-1`
    const result = await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🔥'
    })

    expect(result).toMatchObject({ ok: true, changed: true })
    const rollups = await database.getStatusReactionRollups({
      statusIds: [statusId],
      currentActorId: reactor.id
    })
    expect(rollups).toContainEqual(
      expect.objectContaining({ name: '🔥', count: 1, me: true })
    )
  })

  it('never records a reaction as a favourite', async () => {
    const statusId = `${ACTOR1_ID}/statuses/post-2`
    await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🎉'
    })

    expect(
      await database.isActorLikedStatus({ statusId, actorId: reactor.id })
    ).toBeFalse()
    expect(await database.getLikeCount({ statusId })).toBe(0)
  })

  it('stores a local custom emoji by its bare shortcode', async () => {
    const statusId = `${ACTOR1_ID}/statuses/post-3`
    const result = await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: ':partyparrot:'
    })

    expect(result).toMatchObject({ ok: true, changed: true })
    const rollups = await database.getStatusReactionRollups({
      statusIds: [statusId]
    })
    // Stored colon-free so the rollup resolves the image live from customEmojis.
    expect(rollups).toContainEqual(
      expect.objectContaining({
        name: 'partyparrot',
        url: 'https://test.llun.dev/emojis/partyparrot.gif'
      })
    )
  })

  it.each([
    { description: 'a shortcode with no matching emoji', name: ':nosuch:' },
    { description: 'a disabled custom emoji', name: ':retired:' },
    { description: 'two emoji', name: '🔥🔥' },
    { description: 'arbitrary text', name: 'not an emoji' },
    {
      description: 'a remote namespaced shortcode',
      name: 'blobcat@remote.test'
    }
  ])('rejects $description as invalid-emoji', async ({ name }) => {
    const result = await reactStatus({
      database,
      currentActor: reactor,
      statusId: `${ACTOR1_ID}/statuses/post-1`,
      name
    })

    expect(result).toEqual({ ok: false, reason: 'invalid-emoji' })
  })

  it('reports not-found for a status that does not exist', async () => {
    const result = await reactStatus({
      database,
      currentActor: reactor,
      statusId: 'https://nonexistent.status/id',
      name: '🔥'
    })

    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  it('notifies the author of a local status instead of federating', async () => {
    const statusId = `${ACTOR1_ID}/statuses/post-1`
    await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '💜'
    })

    const notifications = await database.getNotifications({
      actorId: author.id,
      limit: 20,
      types: [NotificationType.enum.emoji_reaction]
    })
    expect(
      notifications.some((entry) => entry.reactionName === '💜')
    ).toBeTrue()
    // A local author has no remote inbox — federating would post to ourselves.
    expect(mockSendReaction).not.toHaveBeenCalled()
  })

  it('reacts to the boosted post rather than the boost wrapper', async () => {
    // The serializer renders an Announce wrapper with empty reactions by design,
    // so a reaction stored against the wrapper would be invisible everywhere.
    const announceId = `${ACTOR2_ID}/statuses/announce-1`
    const boostedId = `${ACTOR1_ID}/statuses/post-3`

    const result = await reactStatus({
      database,
      currentActor: reactor,
      statusId: announceId,
      name: '🛰️'
    })

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(
      (await database.getStatusReactionActors({ statusId: boostedId })).map(
        (entry) => entry.name
      )
    ).toContain('🛰️')
    expect(
      await database.getStatusReactionActors({ statusId: announceId })
    ).toEqual([])
  })

  it('reports cap-reached instead of silently dropping the reaction', async () => {
    const statusId = `${ACTOR2_ID}/statuses/reply-1`
    const names = ['🍎', '🍊', '🍋', '🍉', '🍇', '🍓', '🍒', '🥝']
    expect(names).toHaveLength(MAX_REACTIONS_PER_ACTOR)
    for (const name of names) {
      const result = await reactStatus({
        database,
        currentActor: reactor,
        statusId,
        name
      })
      expect(result).toMatchObject({ ok: true, changed: true })
    }

    expect(
      await reactStatus({
        database,
        currentActor: reactor,
        statusId,
        name: '🍍'
      })
    ).toEqual({ ok: false, reason: 'cap-reached' })

    // A reaction already held stays idempotent rather than reporting the cap.
    expect(
      await reactStatus({
        database,
        currentActor: reactor,
        statusId,
        name: '🍎'
      })
    ).toMatchObject({ ok: true, changed: false })
  })

  it('does not federate again when nothing changed', async () => {
    // Must use a REMOTE-authored status: on a local self-authored one the
    // federation and notification branches are both skipped anyway, so the
    // assertions would hold even with the `changed` guard removed.
    const remoteStatusId = `${EXTERNAL_ACTOR1}/statuses/unchanged-1`
    await database.createNote({
      id: remoteStatusId,
      url: remoteStatusId,
      actorId: EXTERNAL_ACTOR1,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Remote post'
    })

    const first = await reactStatus({
      database,
      currentActor: reactor,
      statusId: remoteStatusId,
      name: '🙌'
    })
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(mockSendReaction).toHaveBeenCalledTimes(1)

    const repeat = await reactStatus({
      database,
      currentActor: reactor,
      statusId: remoteStatusId,
      name: '🙌'
    })

    expect(repeat).toMatchObject({ ok: true, changed: false })
    // Still once: a redelivered reaction must not re-post to the remote inbox.
    expect(mockSendReaction).toHaveBeenCalledTimes(1)
  })
})

describe('unreactStatus', () => {
  const database = getTestSQLDatabase()
  let reactor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    reactor = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
    await database.createCustomEmoji({
      shortcode: 'partyparrot',
      url: 'https://test.llun.dev/emojis/partyparrot.gif',
      staticUrl: 'https://test.llun.dev/emojis/partyparrot.png'
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes exactly the named reaction', async () => {
    const statusId = `${ACTOR1_ID}/statuses/post-1`
    await reactStatus({ database, currentActor: reactor, statusId, name: '🔥' })
    await reactStatus({ database, currentActor: reactor, statusId, name: '💧' })

    const result = await unreactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🔥'
    })

    expect(result).toMatchObject({ ok: true, changed: true })
    const reactors = await database.getStatusReactionActors({ statusId })
    expect(reactors.map((entry) => entry.name)).toEqual(['💧'])
  })

  it.each([
    { description: 'colon-wrapped', name: ':partyparrot:' },
    { description: 'bare', name: 'partyparrot' }
  ])('removes a custom emoji written $description', async ({ name }) => {
    const statusId = `${ACTOR1_ID}/statuses/post-2`
    await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: ':partyparrot:'
    })

    const result = await unreactStatus({
      database,
      currentActor: reactor,
      statusId,
      name
    })

    expect(result).toMatchObject({ changed: true })
    expect(await database.getStatusReactionActors({ statusId })).toEqual([])
  })

  describe('federating the retraction', () => {
    const remoteStatusId = `${EXTERNAL_ACTOR1}/statuses/remote-1`

    beforeAll(async () => {
      // EXTERNAL_ACTOR1 is already seeded by seedDatabase.
      await database.createNote({
        id: remoteStatusId,
        url: remoteStatusId,
        actorId: EXTERNAL_ACTOR1,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Remote post'
      })
    })

    it('sends the Undo for a remote status', async () => {
      await reactStatus({
        database,
        currentActor: reactor,
        statusId: remoteStatusId,
        name: '🔭'
      })

      const result = await unreactStatus({
        database,
        currentActor: reactor,
        statusId: remoteStatusId,
        name: '🔭'
      })

      expect(result).toMatchObject({ changed: true })
      expect(mockSendUndoReaction).toHaveBeenCalledTimes(1)
    })

    it.each([
      {
        description: 'the actor still holds another reaction',
        setup: async () => {
          await reactStatus({
            database,
            currentActor: reactor,
            statusId: remoteStatusId,
            name: '\u{1F30E}'
          })
        }
      },
      {
        description: 'the actor also favourited the status',
        setup: async () => {
          await database.createLike({
            actorId: reactor.id,
            statusId: remoteStatusId
          })
        }
      }
    ])('still sends the Undo when $description', async ({ setup }) => {
      // A reaction-native receiver resolves the Undo by reaction content, so
      // withholding it would leave this emoji visible there forever. That
      // matters more than the favourite a Like-only receiver may also clear —
      // it never rendered the reaction in the first place.
      await reactStatus({
        database,
        currentActor: reactor,
        statusId: remoteStatusId,
        name: '\u{1F30D}'
      })
      await setup()
      vi.clearAllMocks()

      const result = await unreactStatus({
        database,
        currentActor: reactor,
        statusId: remoteStatusId,
        name: '\u{1F30D}'
      })

      expect(result).toMatchObject({ changed: true })
      expect(mockSendUndoReaction).toHaveBeenCalledTimes(1)
    })
  })

  it('still removes a reaction after the status stops being readable', async () => {
    // The author narrows a public post to followers-only afterwards. Refusing
    // would leave the reaction counted in everyone else's rollups forever.
    const statusId = `${ACTOR1_ID}/statuses/narrowed-1`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Public then narrowed'
    })
    await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🔒'
    })
    await database.updateNoteVisibility({
      statusId,
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const result = await unreactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🔒'
    })

    expect(result).toMatchObject({ ok: true, changed: true })
    expect(await database.getStatusReactionActors({ statusId })).toEqual([])
  })

  it('reports not-found for an unreadable status the actor never reacted to', async () => {
    const statusId = `${ACTOR1_ID}/statuses/narrowed-2`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [`${ACTOR1_ID}/followers`],
      cc: [],
      text: 'Never readable'
    })

    const result = await unreactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🔒'
    })

    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reports no change when the reaction was not there', async () => {
    const result = await unreactStatus({
      database,
      currentActor: reactor,
      statusId: `${ACTOR1_ID}/statuses/post-3`,
      name: '🛸'
    })

    expect(result).toMatchObject({ ok: true, changed: false })
    expect(mockSendUndoReaction).not.toHaveBeenCalled()
  })
})
