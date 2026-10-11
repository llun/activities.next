import { withoutBlockedOrMutedAuthors } from '@/lib/database/kysely/visibility/blockMute'
import { notFromExclusiveListMember } from '@/lib/database/kysely/visibility/exclusiveLists'
import { selectFollowTargetActorIds } from '@/lib/database/kysely/visibility/followTarget'
import {
  listEligibleStatus,
  listRepliesPolicyAllows
} from '@/lib/database/kysely/visibility/listEligible'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { applyBlockMuteFilter } from '@/lib/database/sql/utils/blockMuteFilter'
import { applyExclusiveListFilter } from '@/lib/database/sql/utils/exclusiveLists'
import { selectFollowTargetActorIds as selectFollowTargetActorIdsByKnex } from '@/lib/database/sql/utils/followTargetActorIds'
import { applyListEligibleStatusFilter } from '@/lib/database/sql/utils/listEligibleStatus'
import { applyListRepliesPolicyFilter } from '@/lib/database/sql/utils/listRepliesPolicy'
import { whereLocalActor } from '@/lib/database/sql/utils/localActor'
import { applyPotentiallyReadableStatusFilter } from '@/lib/database/sql/utils/statusVisibility'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FollowStatus } from '@/lib/types/domain/follow'
import type { ListRepliesPolicy } from '@/lib/types/domain/list'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// The Kysely visibility predicates must select exactly the rows their Knex
// originals select while both are in use: the Knex ones still serve status,
// or are kept as the reference the Kysely twin is checked against here. Each describe runs both over the same rows, for every
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
  const REPLIES_LIST = 'replies-list'
  // The block/mute filter's clock, fixed so a mute can end exactly on it.
  const MUTE_NOW = Date.UTC(2026, 5, 1)

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

    // Rows for the list predicates and the block/mute filter.
    // A followers collection spelled in upper case: LIKE folds it on SQLite
    // only, the same for both forms on each backend.
    await note('upper-followers', { to: [`${author}/FOLLOWERS`] })
    // recipient owns a list holding follower, and follows stranger.
    await knex('lists').insert({
      id: REPLIES_LIST,
      actorId: recipient,
      title: 'Replies',
      repliesPolicy: 'list',
      exclusive: false,
      createdAt: now,
      updatedAt: now
    })
    await knex('list_accounts').insert({
      id: 'replies-list-follower',
      listId: REPLIES_LIST,
      actorId: recipient,
      targetActorId: follower,
      createdAt: now
    })
    await database.createFollow({
      actorId: recipient,
      targetActorId: stranger,
      status: FollowStatus.enum.Accepted,
      inbox: `${recipient}/inbox`,
      sharedInbox: `https://${DOMAIN}/inbox`
    })
    await knex('follows').insert({
      id: 'stranger-undid-author',
      actorId: stranger,
      actorHost: DOMAIN,
      targetActorId: author,
      targetActorHost: DOMAIN,
      status: FollowStatus.enum.Undo,
      createdAt: now,
      updatedAt: now
    })
    const recipientParent = await note('recipient-parent', {
      actorId: recipient,
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await note('reply-to-recipient', { to: [], reply: recipientParent })
    await note('self-reply', {
      to: [ACTIVITY_STREAM_PUBLIC],
      reply: ids['public']
    })
    await note('recipient-reply-to-unstored', {
      actorId: recipient,
      to: [ACTIVITY_STREAM_PUBLIC],
      reply: statusId(stranger, 'never-stored')
    })
    await note('blocked-public', {
      actorId: blocked,
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await database.createAnnounce({
      id: statusId(stranger, 'announce-blocked'),
      actorId: stranger,
      originalStatusId: ids['blocked-public'],
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    ids['announce-blocked'] = statusId(stranger, 'announce-blocked')
    // participant mutes author for good, recipient's mute of author has
    // expired, pendingFollower's ends exactly at MUTE_NOW (still active), and
    // follower's ends later.
    for (const [mutedBy, target, endsAt] of [
      [participant, author, null],
      [recipient, author, MUTE_NOW - 1],
      [pendingFollower, author, MUTE_NOW],
      [follower, remoteAuthor, MUTE_NOW + 60_000]
    ] as const) {
      await knex('mutes').insert({
        id: `mute-${mutedBy.split('/').pop()}-${target.split('/').pop()}`,
        actorId: mutedBy,
        actorHost: DOMAIN,
        targetActorId: target,
        targetActorHost: new URL(target).host,
        notifications: true,
        endsAt,
        createdAt: now,
        updatedAt: now
      })
    }

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
  const sortedIds = (rows: { id: string | null }[]) =>
    rows.map(({ id }) => String(id)).sort()

  const listEligibleByKnex = async () => {
    const query = knex('statuses').select('statuses.id')
    applyListEligibleStatusFilter({ database: knex, query })
    return sortedIds(await query)
  }

  const listEligibleByKysely = async () => {
    const db = testDb.db
    return sortedIds(
      await db
        .selectFrom('statuses')
        .select('statuses.id')
        .where((eb) => listEligibleStatus(db, eb))
        .execute()
    )
  }

  it('selects the same list-eligible statuses', async () => {
    const [knexIds, kyselyIds] = await Promise.all([
      listEligibleByKnex(),
      listEligibleByKysely()
    ])
    expect(kyselyIds).toEqual(knexIds)
    expect(knexIds.length).toBeGreaterThan(0)
    expect(knexIds.length).toBeLessThan(Object.keys(ids).length)
  })

  it.each([
    { key: 'public', eligible: true },
    { key: 'public-compact', eligible: true },
    { key: 'unlisted', eligible: true },
    { key: 'followers-only', eligible: true },
    { key: 'remote-stored-followers', eligible: true },
    { key: 'bare-fallback-followers', eligible: true },
    { key: 'ghost-author-followers', eligible: true },
    { key: 'announce-reply', eligible: true },
    { key: 'other-collection', eligible: false },
    { key: 'direct', eligible: false },
    { key: 'direct-cc', eligible: false },
    { key: 'reply-by-id', eligible: false }
  ])(
    'agrees that $key is list-eligible=$eligible',
    async ({ key, eligible }) => {
      const id = ids[key]
      expect(id).toBeDefined()
      expect((await listEligibleByKnex()).includes(id)).toBe(eligible)
      expect((await listEligibleByKysely()).includes(id)).toBe(eligible)
    }
  )

  const repliesAllowedByKnex = async (
    repliesPolicy: ListRepliesPolicy,
    ownerId: string,
    listId = REPLIES_LIST
  ) => {
    const query = knex('statuses').select('statuses.id')
    applyListRepliesPolicyFilter({
      database: knex,
      query,
      repliesPolicy,
      listId,
      ownerId
    })
    return sortedIds(await query)
  }

  const repliesAllowedByKysely = async (
    repliesPolicy: ListRepliesPolicy,
    ownerId: string,
    listId = REPLIES_LIST
  ) =>
    sortedIds(
      await testDb.db
        .selectFrom('statuses')
        .select('statuses.id')
        .where((eb) =>
          listRepliesPolicyAllows(eb, { repliesPolicy, listId, ownerId })
        )
        .execute()
    )

  const policies: ListRepliesPolicy[] = ['none', 'list', 'followed']

  it.each(
    policies.flatMap((policy) =>
      Object.entries(viewers).map(([name, ownerId]) => ({
        policy,
        name,
        ownerId
      }))
    )
  )(
    'lets the same replies through under $policy for owner $name',
    async ({ policy, ownerId }) => {
      for (const listId of [REPLIES_LIST, 'another-list']) {
        const [knexIds, kyselyIds] = await Promise.all([
          repliesAllowedByKnex(policy, ownerId, listId),
          repliesAllowedByKysely(policy, ownerId, listId)
        ])
        expect(kyselyIds).toEqual(knexIds)
        expect(knexIds.length).toBeGreaterThan(0)
        expect(knexIds.length).toBeLessThan(Object.keys(ids).length)
      }
    }
  )

  it.each([
    { key: 'public', policy: 'none', allowed: true },
    { key: 'self-reply', policy: 'none', allowed: true },
    { key: 'reply-to-recipient', policy: 'none', allowed: true },
    { key: 'reply-by-id', policy: 'none', allowed: false },
    { key: 'reply-by-id', policy: 'list', allowed: true },
    { key: 'reply-by-url', policy: 'list', allowed: true },
    { key: 'reply-by-url-wrong-hash', policy: 'list', allowed: false },
    { key: 'reply-hash-only', policy: 'list', allowed: false },
    { key: 'reply-by-id', policy: 'followed', allowed: false },
    { key: 'conversation-reply-by-id', policy: 'followed', allowed: true },
    { key: 'conversation-reply-by-url', policy: 'followed', allowed: true },
    { key: 'conversation-reply-by-id', policy: 'list', allowed: false },
    { key: 'reply-to-unrelated', policy: 'followed', allowed: false },
    { key: 'recipient-reply-to-unstored', policy: 'followed', allowed: true },
    { key: 'recipient-reply-to-unstored', policy: 'list', allowed: false }
  ] as const)(
    'agrees that $key passes $policy for the list owner as $allowed',
    async ({ key, policy, allowed }) => {
      const id = ids[key]
      expect(id).toBeDefined()
      expect((await repliesAllowedByKnex(policy, recipient)).includes(id)).toBe(
        allowed
      )
      expect(
        (await repliesAllowedByKysely(policy, recipient)).includes(id)
      ).toBe(allowed)
    }
  )

  it('lets a member reply through only for the list that holds the member', async () => {
    const id = ids['reply-by-id']
    expect(
      (await repliesAllowedByKnex('list', recipient, 'another-list')).includes(
        id
      )
    ).toBe(false)
    expect(
      (
        await repliesAllowedByKysely('list', recipient, 'another-list')
      ).includes(id)
    ).toBe(false)
    expect((await repliesAllowedByKysely('list', stranger)).includes(id)).toBe(
      false
    )
  })

  const unmoderatedByKnex = async (viewerId: string) => {
    const query = knex('statuses').select('statuses.id')
    applyBlockMuteFilter({
      database: knex,
      query,
      viewerActorId: viewerId,
      now: MUTE_NOW
    })
    return sortedIds(await query)
  }

  const unmoderatedByKysely = async (viewerId: string) =>
    sortedIds(
      await withoutBlockedOrMutedAuthors(
        testDb.db.selectFrom('statuses').select('statuses.id'),
        viewerId,
        MUTE_NOW
      ).execute()
    )

  it.each(Object.entries(viewers))(
    'hides the same blocked and muted statuses from %s',
    async (_name, viewerId) => {
      const [knexIds, kyselyIds] = await Promise.all([
        unmoderatedByKnex(viewerId),
        unmoderatedByKysely(viewerId)
      ])
      expect(kyselyIds).toEqual(knexIds)
      expect(knexIds.length).toBeGreaterThan(0)
    }
  )

  it.each([
    { key: 'blocked-public', viewer: author, shown: false },
    { key: 'announce-blocked', viewer: author, shown: false },
    { key: 'public', viewer: blocked, shown: false },
    { key: 'announce-public', viewer: blocked, shown: false },
    { key: 'blocked-public', viewer: stranger, shown: true },
    { key: 'public', viewer: participant, shown: false },
    { key: 'public', viewer: recipient, shown: true },
    { key: 'public', viewer: pendingFollower, shown: false },
    { key: 'remote-public', viewer: follower, shown: false },
    { key: 'public', viewer: follower, shown: true },
    { key: 'public', viewer: nobody, shown: true }
  ])(
    'agrees that $key is shown=$shown to $viewer',
    async ({ key, viewer, shown }) => {
      const id = ids[key]
      expect(id).toBeDefined()
      expect((await unmoderatedByKnex(viewer)).includes(id)).toBe(shown)
      expect((await unmoderatedByKysely(viewer)).includes(id)).toBe(shown)
    }
  )

  const ghostAuthor = actor('ghost-author', 'gone.test')
  const followTargets = [
    author,
    remoteAuthor,
    bareAuthor,
    ghostAuthor,
    stranger,
    author,
    nobody
  ]
  it.each(
    [follower, pendingFollower, stranger, recipient, blocked, nobody].flatMap(
      (actorId) =>
        [
          [FollowStatus.enum.Accepted],
          [FollowStatus.enum.Requested],
          [FollowStatus.enum.Accepted, FollowStatus.enum.Requested],
          [FollowStatus.enum.Undo],
          []
        ].map((statuses) => ({ actorId, statuses }))
    )
  )(
    'finds the same follow targets of $actorId in $statuses',
    async ({ actorId, statuses }) => {
      for (const targets of [followTargets, [], [nobody]]) {
        for (const forShare of [false, true]) {
          const [knexIds, kyselyIds] = await Promise.all([
            selectFollowTargetActorIdsByKnex(knex, actorId, targets, statuses, {
              forShare
            }),
            selectFollowTargetActorIds(testDb.db, actorId, targets, statuses, {
              forShare
            })
          ])
          expect([...kyselyIds].sort()).toEqual([...knexIds].sort())
          // Each id once.
          expect(new Set(kyselyIds).size).toBe(kyselyIds.length)
        }
      }
    }
  )

  it('finds a follow target only for a matching status', async () => {
    const accepted = await selectFollowTargetActorIds(
      testDb.db,
      follower,
      followTargets,
      [FollowStatus.enum.Accepted]
    )
    expect([...accepted].sort()).toEqual(
      [author, bareAuthor, ghostAuthor, remoteAuthor].sort()
    )
    expect(
      await selectFollowTargetActorIds(testDb.db, stranger, followTargets, [
        FollowStatus.enum.Undo
      ])
    ).toEqual([author])
    expect(
      await selectFollowTargetActorIds(
        testDb.db,
        follower,
        [stranger],
        [FollowStatus.enum.Accepted]
      )
    ).toEqual([])
  })

  // Seeded last, so the exclusive lists added here reach none of the list
  // cases above. Each `timelines` row is told apart by its statusId.
  describe('exclusive lists', () => {
    const timelineRows: Record<string, string | null> = {
      'excl-author': author,
      'excl-follower': follower,
      'excl-stranger': stranger,
      'excl-remote': remoteAuthor,
      'excl-bare': bareAuthor,
      'excl-no-author': null
    }

    beforeAll(async () => {
      const now = new Date()
      await knex('lists').insert([
        // follower's exclusive list holds author and follower itself.
        {
          id: 'follower-exclusive',
          actorId: follower,
          title: 'Exclusive',
          repliesPolicy: 'list',
          exclusive: true,
          createdAt: now,
          updatedAt: now
        },
        // follower's ordinary list holds stranger.
        {
          id: 'follower-ordinary',
          actorId: follower,
          title: 'Ordinary',
          repliesPolicy: 'list',
          exclusive: false,
          createdAt: now,
          updatedAt: now
        },
        // Another owner's exclusive list, holding remoteAuthor.
        {
          id: 'recipient-exclusive',
          actorId: recipient,
          title: 'Exclusive',
          repliesPolicy: 'list',
          exclusive: true,
          createdAt: now,
          updatedAt: now
        }
      ])
      await knex('list_accounts').insert(
        [
          ['follower-exclusive', follower, author],
          ['follower-exclusive', follower, follower],
          ['follower-ordinary', follower, stranger],
          ['recipient-exclusive', recipient, remoteAuthor],
          // The list's owner decides, not the membership row's own actorId.
          ['follower-exclusive', stranger, bareAuthor]
        ].map(([listId, actorId, targetActorId]) => ({
          id: `${listId}:${targetActorId}`,
          listId,
          actorId,
          targetActorId,
          createdAt: now
        }))
      )
      await knex('timelines').insert(
        Object.entries(timelineRows).map(([key, statusActorId]) => ({
          actorId: follower,
          timeline: 'main',
          statusId: key,
          statusActorId,
          createdAt: now,
          updatedAt: now
        }))
      )
    })

    const shownByKnex = async (viewerId: string) => {
      const query = knex('timelines').select('timelines.statusId')
      applyExclusiveListFilter({
        database: knex,
        query,
        viewerActorId: viewerId
      })
      return ((await query) as { statusId: string }[])
        .map(({ statusId }) => statusId)
        .sort()
    }

    const shownByKysely = async (viewerId: string) =>
      (
        await testDb.db
          .selectFrom('timelines')
          .select('timelines.statusId')
          .where((eb) => notFromExclusiveListMember(eb, viewerId))
          .execute()
      )
        .map(({ statusId }) => statusId as string)
        .sort()

    it.each(Object.entries(viewers))(
      'shows the same timeline rows to %s',
      async (_name, viewerId) => {
        const [knexIds, kyselyIds] = await Promise.all([
          shownByKnex(viewerId),
          shownByKysely(viewerId)
        ])
        expect(kyselyIds).toEqual(knexIds)
        expect(knexIds.length).toBeGreaterThan(0)
      }
    )

    it.each([
      { key: 'excl-author', viewer: follower, shown: false },
      { key: 'excl-bare', viewer: follower, shown: false },
      { key: 'excl-follower', viewer: follower, shown: true },
      { key: 'excl-stranger', viewer: follower, shown: true },
      { key: 'excl-remote', viewer: follower, shown: true },
      { key: 'excl-no-author', viewer: follower, shown: true },
      { key: 'excl-remote', viewer: recipient, shown: false },
      { key: 'excl-author', viewer: recipient, shown: true },
      { key: 'excl-author', viewer: stranger, shown: true }
    ])(
      'agrees that $key is shown=$shown to $viewer',
      async ({ key, viewer, shown }) => {
        expect((await shownByKnex(viewer)).includes(key)).toBe(shown)
        expect((await shownByKysely(viewer)).includes(key)).toBe(shown)
      }
    )
  })
})
