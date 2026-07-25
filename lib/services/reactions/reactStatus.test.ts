import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  reactStatus,
  unreactStatus
} from '@/lib/services/reactions/reactStatus'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

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

  it('does not notify or federate when nothing changed', async () => {
    const statusId = `${ACTOR2_ID}/statuses/post-2`
    const first = await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🙌'
    })
    expect(first).toMatchObject({ changed: true })

    vi.clearAllMocks()
    const before = await database.getNotifications({
      actorId: reactor.id,
      limit: 50,
      types: [NotificationType.enum.emoji_reaction]
    })

    const repeat = await reactStatus({
      database,
      currentActor: reactor,
      statusId,
      name: '🙌'
    })

    expect(repeat).toMatchObject({ ok: true, changed: false })
    expect(mockSendReaction).not.toHaveBeenCalled()
    const after = await database.getNotifications({
      actorId: reactor.id,
      limit: 50,
      types: [NotificationType.enum.emoji_reaction]
    })
    expect(after).toHaveLength(before.length)
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
