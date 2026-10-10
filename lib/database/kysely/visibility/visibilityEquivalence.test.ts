import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { whereLocalActor } from '@/lib/database/sql/utils/localActor'
import { applyPotentiallyReadableStatusFilter } from '@/lib/database/sql/utils/statusVisibility'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// The Kysely visibility predicates must select exactly the rows their Knex
// originals select while both are in use: the Knex ones still serve list,
// collection and status. Each describe runs both over the same rows, for every
// viewer, and compares the id sets; the named cases say which arm broke.
describe('Kysely visibility predicates match their Knex originals', () => {
  const testDb = createTestDatabase()
  const { database, knex } = testDb

  const DOMAIN = 'llun.test'
  const actor = (name: string, domain = DOMAIN) =>
    `https://${domain}/users/${name}`
  const author = actor('author')
  // Stores a followers URL that is not `<id>/followers`.
  const remoteAuthor = actor('remote-author', 'remote.test')
  const remoteFollowersUrl = 'https://remote.test/collections/remote-followers'
  // Has no followersUrl in its settings: only the `<id>/followers` fallback.
  const bareAuthor = actor('bare-author', 'remote.test')
  const follower = actor('follower')
  const pendingFollower = actor('pending-follower')
  const stranger = actor('stranger')
  const recipient = actor('recipient')
  const participant = actor('participant')
  const blocked = actor('blocked')
  const nobody = actor('nobody')
  const viewers = {
    author,
    remoteAuthor,
    bareAuthor,
    follower,
    pendingFollower,
    stranger,
    recipient,
    participant,
    blocked,
    nobody
  }

  const ids: Record<string, string> = {}
  const statusId = (actorId: string, key: string) =>
    `${actorId}/statuses/${key}`

  const note = async (
    key: string,
    {
      actorId = author,
      to,
      cc = [],
      reply,
      url
    }: {
      actorId?: string
      to: string[]
      cc?: string[]
      reply?: string
      url?: string
    }
  ) => {
    const id = statusId(actorId, key)
    await database.createNote({
      id,
      url: url ?? id,
      actorId,
      text: key,
      to,
      cc,
      ...(reply ? { reply } : null)
    })
    ids[key] = id
    return id
  }

  const readableByKnex = async (viewerId: string) => {
    const query = knex('statuses').select('statuses.id')
    applyPotentiallyReadableStatusFilter({
      database: knex,
      query,
      visibleToActorId: viewerId
    })
    return ((await query) as { id: string }[]).map(({ id }) => id).sort()
  }

  const readableByKysely = async (viewerId: string) => {
    const db = testDb.db
    const rows = await db
      .selectFrom('statuses')
      .select('statuses.id')
      .where((eb) => potentiallyReadableStatus(db, eb, viewerId))
      .execute()
    return rows.map(({ id }) => id).sort()
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()

    for (const [id, privateKey] of [
      [author, 'author-key'],
      [remoteAuthor, undefined],
      [bareAuthor, undefined],
      [follower, 'follower-key'],
      [pendingFollower, 'pending-key'],
      [stranger, 'stranger-key'],
      [recipient, 'recipient-key'],
      [participant, 'participant-key'],
      [blocked, '']
    ] as const) {
      const [, , domain, , username] = id.split('/')
      await database.createActor({
        actorId: id,
        username,
        domain,
        publicKey: `public-${username}`,
        ...(privateKey === undefined ? null : { privateKey }),
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`,
        followersUrl:
          id === remoteAuthor ? remoteFollowersUrl : `${id}/followers`,
        createdAt: Date.now()
      })
    }
    for (const targetActorId of [author, remoteAuthor, bareAuthor]) {
      await database.createFollow({
        actorId: follower,
        targetActorId,
        status: FollowStatus.enum.Accepted,
        inbox: `${follower}/inbox`,
        sharedInbox: `https://${DOMAIN}/inbox`
      })
      await database.createFollow({
        actorId: pendingFollower,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: `${pendingFollower}/inbox`,
        sharedInbox: `https://${DOMAIN}/inbox`
      })
    }
    // A blocked follower: blocks are search's own filter, not this predicate's,
    // so both forms must still agree on what it can read.
    await database.createFollow({
      actorId: blocked,
      targetActorId: author,
      status: FollowStatus.enum.Accepted,
      inbox: `${blocked}/inbox`,
      sharedInbox: `https://${DOMAIN}/inbox`
    })
    await database.createBlock({
      actorId: author,
      targetActorId: blocked,
      uri: `${author}#blocks/blocked`
    })

    await note('public', { to: [ACTIVITY_STREAM_PUBLIC] })
    await note('public-compact', { to: [ACTIVITY_STREAM_PUBLIC_COMPACT] })
    await note('unlisted', {
      to: [`${author}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await note('followers-only', { to: [`${author}/followers`] })
    await note('other-collection', {
      to: [`https://${DOMAIN}/lists/runners`]
    })
    await note('remote-stored-followers', {
      actorId: remoteAuthor,
      to: [remoteFollowersUrl]
    })
    await note('remote-fallback-followers', {
      actorId: remoteAuthor,
      to: [`${remoteAuthor}/followers`]
    })
    await note('bare-fallback-followers', {
      actorId: bareAuthor,
      to: [`${bareAuthor}/followers`]
    })
    await note('direct', { to: [recipient] })
    await note('direct-cc', { to: [stranger], cc: [recipient] })
    await note('remote-public', {
      actorId: remoteAuthor,
      to: [ACTIVITY_STREAM_PUBLIC]
    })

    await database.createAnnounce({
      id: statusId(author, 'announce-public'),
      actorId: author,
      originalStatusId: ids['public'],
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    ids['announce-public'] = statusId(author, 'announce-public')
    await database.createAnnounce({
      id: statusId(author, 'announce-followers'),
      actorId: author,
      originalStatusId: ids['followers-only'],
      to: [`${author}/followers`],
      cc: []
    })
    ids['announce-followers'] = statusId(author, 'announce-followers')

    // Replies with no recipients, to parents the viewer wrote or takes part in.
    const followerParent = await note('follower-parent', {
      actorId: follower,
      to: [ACTIVITY_STREAM_PUBLIC],
      url: `https://${DOMAIN}/@follower/parent`
    })
    await note('reply-by-id', { to: [], reply: followerParent })
    await note('reply-by-url', {
      to: [],
      reply: `https://${DOMAIN}/@follower/parent`
    })
    await note('reply-by-url-wrong-hash', {
      to: [],
      reply: `https://${DOMAIN}/@follower/parent`
    })
    await knex('statuses')
      .where('id', ids['reply-by-url-wrong-hash'])
      .update({ replyHash: 'not-the-parent-hash' })
    // The parent's url hash with another reply url: a hash collision.
    await note('reply-hash-only', {
      to: [],
      reply: `https://${DOMAIN}/@follower/elsewhere`
    })
    const { urlHash: parentUrlHash } = await knex('statuses')
      .where('id', followerParent)
      .first('urlHash')
    await knex('statuses')
      .where('id', ids['reply-hash-only'])
      .update({ replyHash: parentUrlHash })
    await note('reply-with-recipients', {
      to: [stranger],
      reply: followerParent
    })
    await note('reply-to-unrelated', {
      to: [],
      reply: statusId(stranger, 'missing')
    })
    await database.createPoll({
      id: statusId(author, 'poll-reply'),
      url: statusId(author, 'poll-reply'),
      actorId: author,
      text: 'poll reply',
      to: [],
      cc: [],
      reply: followerParent,
      choices: ['yes', 'no'],
      endAt: Date.now() + 60_000
    })
    ids['poll-reply'] = statusId(author, 'poll-reply')
    // An Announce never counts as a recipientless reply.
    await database.createAnnounce({
      id: statusId(author, 'announce-reply'),
      actorId: author,
      originalStatusId: ids['public'],
      to: [],
      cc: []
    })
    ids['announce-reply'] = statusId(author, 'announce-reply')
    await knex('statuses')
      .where('id', ids['announce-reply'])
      .update({ reply: followerParent })

    const conversationParent = await note('conversation-parent', {
      actorId: stranger,
      to: [participant],
      url: `https://${DOMAIN}/@stranger/conversation`
    })
    const now = new Date()
    await knex('direct_conversations').insert({
      id: 'conversation-1',
      rootStatusId: conversationParent,
      createdAt: now,
      updatedAt: now
    })
    await knex('direct_conversation_statuses').insert({
      conversationId: 'conversation-1',
      statusId: conversationParent,
      createdAt: now,
      updatedAt: now
    })
    await knex('direct_conversation_participants').insert(
      [stranger, participant].map((actorId) => ({
        id: `conversation-1:${actorId}`,
        conversationId: 'conversation-1',
        actorId,
        createdAt: now,
        updatedAt: now
      }))
    )
    await note('conversation-reply-by-id', {
      actorId: author,
      to: [],
      reply: conversationParent
    })
    await note('conversation-reply-by-url', {
      actorId: author,
      to: [],
      reply: `https://${DOMAIN}/@stranger/conversation`
    })
    // A second conversation, between stranger and recipient only.
    const secondParent = await note('second-conversation-parent', {
      actorId: stranger,
      to: [recipient]
    })
    await knex('direct_conversations').insert({
      id: 'conversation-2',
      rootStatusId: secondParent,
      createdAt: now,
      updatedAt: now
    })
    await knex('direct_conversation_statuses').insert({
      conversationId: 'conversation-2',
      statusId: secondParent,
      createdAt: now,
      updatedAt: now
    })
    await knex('direct_conversation_participants').insert(
      [stranger, recipient].map((actorId) => ({
        id: `conversation-2:${actorId}`,
        conversationId: 'conversation-2',
        actorId,
        createdAt: now,
        updatedAt: now
      }))
    )
    await note('second-conversation-reply', {
      actorId: author,
      to: [],
      reply: secondParent
    })

    // Followers-only, by an author with no actor row: only the
    // `<id>/followers` fallback can match.
    const ghostAuthor = actor('ghost-author', 'gone.test')
    ids['ghost-author-followers'] = statusId(ghostAuthor, 'followers')
    await knex('statuses').insert({
      id: ids['ghost-author-followers'],
      url: ids['ghost-author-followers'],
      actorId: ghostAuthor,
      type: 'Note',
      content: 'ghost',
      reply: '',
      createdAt: now,
      updatedAt: now
    })
    await knex('recipients').insert({
      id: `${ids['ghost-author-followers']}:to`,
      statusId: ids['ghost-author-followers'],
      actorId: `${ghostAuthor}/followers`,
      type: 'to',
      createdAt: now,
      updatedAt: now
    })
    await knex('follows').insert({
      id: 'follower-follows-ghost',
      actorId: follower,
      actorHost: DOMAIN,
      targetActorId: ghostAuthor,
      targetActorHost: 'gone.test',
      status: FollowStatus.enum.Accepted,
      createdAt: now,
      updatedAt: now
    })

    // Last: the facade cannot read an actor without a followers URL back.
    const bareRow = await knex('actors').where('id', bareAuthor).first()
    const { followersUrl: _followersUrl, ...bareSettings } =
      typeof bareRow.settings === 'string'
        ? JSON.parse(bareRow.settings)
        : bareRow.settings
    await knex('actors')
      .where('id', bareAuthor)
      .update({ settings: JSON.stringify(bareSettings) })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it.each(Object.entries(viewers))(
    'selects the same statuses for %s',
    async (_name, viewerId) => {
      const [knexIds, kyselyIds] = await Promise.all([
        readableByKnex(viewerId),
        readableByKysely(viewerId)
      ])
      expect(kyselyIds).toEqual(knexIds)
      // Not trivially equal: every viewer reads some rows and not others.
      expect(knexIds.length).toBeGreaterThan(0)
      expect(knexIds.length).toBeLessThan(Object.keys(ids).length)
    }
  )

  it.each([
    { key: 'public', viewer: nobody, readable: true },
    { key: 'public-compact', viewer: nobody, readable: true },
    { key: 'unlisted', viewer: nobody, readable: true },
    { key: 'followers-only', viewer: follower, readable: true },
    { key: 'followers-only', viewer: pendingFollower, readable: false },
    { key: 'followers-only', viewer: stranger, readable: false },
    { key: 'followers-only', viewer: blocked, readable: true },
    { key: 'followers-only', viewer: author, readable: true },
    { key: 'other-collection', viewer: follower, readable: false },
    { key: 'remote-stored-followers', viewer: follower, readable: true },
    { key: 'remote-stored-followers', viewer: stranger, readable: false },
    { key: 'remote-fallback-followers', viewer: follower, readable: true },
    { key: 'bare-fallback-followers', viewer: follower, readable: true },
    { key: 'direct', viewer: recipient, readable: true },
    { key: 'direct', viewer: stranger, readable: false },
    { key: 'direct-cc', viewer: recipient, readable: true },
    { key: 'announce-public', viewer: nobody, readable: true },
    { key: 'announce-followers', viewer: follower, readable: true },
    { key: 'announce-followers', viewer: nobody, readable: false },
    { key: 'reply-by-id', viewer: follower, readable: true },
    { key: 'reply-by-id', viewer: stranger, readable: false },
    { key: 'reply-by-url', viewer: follower, readable: true },
    { key: 'reply-by-url-wrong-hash', viewer: follower, readable: false },
    { key: 'reply-hash-only', viewer: follower, readable: false },
    { key: 'reply-with-recipients', viewer: follower, readable: false },
    { key: 'reply-to-unrelated', viewer: follower, readable: false },
    { key: 'poll-reply', viewer: follower, readable: true },
    { key: 'announce-reply', viewer: follower, readable: false },
    { key: 'conversation-reply-by-id', viewer: participant, readable: true },
    { key: 'conversation-reply-by-url', viewer: participant, readable: true },
    { key: 'conversation-reply-by-id', viewer: recipient, readable: false },
    { key: 'second-conversation-reply', viewer: recipient, readable: true },
    { key: 'second-conversation-reply', viewer: participant, readable: false },
    { key: 'ghost-author-followers', viewer: follower, readable: true },
    { key: 'ghost-author-followers', viewer: stranger, readable: false }
  ])(
    'agrees that $key is readable=$readable for $viewer',
    async ({ key, viewer, readable }) => {
      const id = ids[key]
      expect(id).toBeDefined()
      const [knexIds, kyselyIds] = await Promise.all([
        readableByKnex(viewer),
        readableByKysely(viewer)
      ])
      expect(knexIds.includes(id)).toBe(readable)
      expect(kyselyIds.includes(id)).toBe(readable)
    }
  )

  it('selects the same local actors', async () => {
    const knexIds = (
      (await knex('actors')
        .select('actors.id')
        .modify(whereLocalActor, 'actors.privateKey')) as { id: string }[]
    )
      .map(({ id }) => id)
      .sort()
    const kyselyIds = (
      await testDb.db
        .selectFrom('actors')
        .select('actors.id')
        .where(isLocalActor)
        .execute()
    )
      .map(({ id }) => String(id))
      .sort()

    expect(kyselyIds).toEqual(knexIds)
    // A null key (remoteAuthor, bareAuthor) and an empty one (blocked) are
    // both remote.
    expect(knexIds).toContain(author)
    expect(knexIds).not.toContain(remoteAuthor)
    expect(knexIds).not.toContain(blocked)
  })
})
