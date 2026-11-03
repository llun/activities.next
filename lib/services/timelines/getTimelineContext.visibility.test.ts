import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getTimelineContext } from './getTimelineContext'

// Which parents a viewer is shown a preview of, end to end on a real database
// with the real readability rule (the unit tests beside this mock it). The
// local profile serves these previews to signed-out visitors and strangers, so
// a parent the viewer may not read must leave no trace in the context: no
// entry under its id or url, and none of its text or author.

const LOCAL = 'llun.test'
const REMOTE = 'remote-context.test'

describe('getTimelineContext viewer scoping', () => {
  const { database, prepare } = createTestDatabase()

  const actorIdOf = (domain: string, username: string) =>
    `https://${domain}/users/${username}`
  const createActor = async (
    username: string,
    { domain = LOCAL }: { domain?: string } = {}
  ) => {
    const actorId = actorIdOf(domain, username)
    await database.createActor({
      actorId,
      username,
      domain,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`,
      publicKey: 'publicKey',
      // Only a local actor carries a private key.
      ...(domain === LOCAL ? { privateKey: 'privateKey' } : {}),
      createdAt: Date.now()
    })
    return actorId
  }
  const follow = (actorId: string, targetActorId: string) =>
    database.createFollow({
      actorId,
      targetActorId,
      inbox: `${targetActorId}/inbox`,
      sharedInbox: `https://${LOCAL}/inbox`,
      status: FollowStatus.enum.Accepted
    })

  // The profile owner, whose page holds the replies; the parents' authors (one
  // local, one remote, stored here); and the viewers.
  let profileOwnerId: string
  let parentAuthorId: string
  let remoteAuthorId: string
  let followerId: string
  let strangerId: string
  let addresseeId: string
  let thirdPartyId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    profileOwnerId = await createActor('profile-owner')
    parentAuthorId = await createActor('parent-author')
    remoteAuthorId = await createActor('remote-author', { domain: REMOTE })
    followerId = await createActor('follower')
    strangerId = await createActor('stranger')
    addresseeId = await createActor('addressee')
    thirdPartyId = await createActor('third-party')
    await follow(followerId, parentAuthorId)
    await follow(followerId, remoteAuthorId)
    // A follow request that was never accepted is not a follower.
    await database.createFollow({
      actorId: strangerId,
      targetActorId: parentAuthorId,
      inbox: `${parentAuthorId}/inbox`,
      sharedInbox: `https://${LOCAL}/inbox`,
      status: FollowStatus.enum.Requested
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  type Audience =
    'public' | 'unlisted' | 'followers-only' | 'direct' | 'addressed-to-viewer'
  const recipientsFor = (
    audience: Audience,
    authorId: string
  ): { to: string[]; cc: string[] } => {
    switch (audience) {
      case 'public':
        return { to: [ACTIVITY_STREAM_PUBLIC], cc: [`${authorId}/followers`] }
      case 'unlisted':
        return { to: [`${authorId}/followers`], cc: [ACTIVITY_STREAM_PUBLIC] }
      case 'followers-only':
        return { to: [`${authorId}/followers`], cc: [] }
      case 'direct':
        // Addressed to someone who is none of the viewers.
        return { to: [thirdPartyId], cc: [] }
      case 'addressed-to-viewer':
        return { to: [addresseeId], cc: [] }
    }
  }

  let statusCount = 0
  // A parent with `audience` and the profile owner's public reply to it, as the
  // profile's page serves it.
  const seedReply = async (audience: Audience, authorId = parentAuthorId) => {
    statusCount += 1
    const parentId = `${authorId}/statuses/context-parent-${statusCount}`
    const parentUrl = `https://${new URL(authorId).host}/@author/${statusCount}`
    const parentText = `Secret parent text ${statusCount}`
    await database.createNote({
      id: parentId,
      url: parentUrl,
      actorId: authorId,
      text: parentText,
      ...recipientsFor(audience, authorId)
    })
    const replyId = `${profileOwnerId}/statuses/context-reply-${statusCount}`
    await database.createNote({
      id: replyId,
      url: replyId,
      actorId: profileOwnerId,
      text: 'A public reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: parentId
    })
    const reply = (await database.getStatus({ statusId: replyId })) as Status
    return { reply, parentId, parentUrl, parentText }
  }

  const viewerFor = async (viewer: string | null): Promise<Actor | null> => {
    if (!viewer) return null
    const ids: Record<string, string> = {
      'non-follower': strangerId,
      follower: followerId,
      owner: parentAuthorId,
      addressee: addresseeId
    }
    return (await database.getActorFromId({ id: ids[viewer] })) as Actor
  }

  const expectPreviewed = async (
    seeded: Awaited<ReturnType<typeof seedReply>>,
    viewer: string | null,
    previewed: boolean
  ) => {
    const context = await getTimelineContext({
      database,
      currentActor: await viewerFor(viewer),
      statuses: [seeded.reply]
    })
    if (previewed) {
      expect(context.ancestorsById[seeded.parentId]).toMatchObject({
        id: seeded.parentId,
        text: seeded.parentText
      })
      return
    }
    expect(context.ancestorsById).toEqual({})
    // Not under any alias, and nothing of it anywhere in the payload.
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain(seeded.parentText)
    expect(serialized).not.toContain(seeded.parentUrl)
  }

  const VIEWERS = [
    null,
    'non-follower',
    'follower',
    'owner',
    'addressee'
  ] as const
  // Who may read the parent, by its audience; `owner` is the parent's author.
  const READERS: Record<Audience, ReadonlyArray<(typeof VIEWERS)[number]>> = {
    public: VIEWERS,
    unlisted: VIEWERS,
    'followers-only': ['follower', 'owner'],
    direct: ['owner'],
    'addressed-to-viewer': ['owner', 'addressee']
  }
  const matrix = (Object.keys(READERS) as Audience[]).flatMap((audience) =>
    VIEWERS.map((viewer) => ({
      audience,
      viewer,
      viewerName: viewer ?? 'signed-out visitor',
      previewed: READERS[audience].includes(viewer)
    }))
  )

  it.each(matrix)(
    'a $audience parent, viewed by $viewerName: previewed $previewed',
    async ({ audience, viewer, previewed }) => {
      const seeded = await seedReply(audience)

      await expectPreviewed(seeded, viewer, previewed)
    }
  )

  it.each([
    { audience: 'public', viewer: null, previewed: true },
    { audience: 'followers-only', viewer: null, previewed: false },
    { audience: 'followers-only', viewer: 'non-follower', previewed: false },
    { audience: 'followers-only', viewer: 'follower', previewed: true }
  ] as const)(
    'a remote $audience parent stored here, viewed by $viewer (null: signed out): previewed $previewed',
    async ({ audience, viewer, previewed }) => {
      const seeded = await seedReply(audience, remoteAuthorId)

      await expectPreviewed(seeded, viewer, previewed)
    }
  )

  it.each([null, 'follower'] as const)(
    'gives no preview for a parent this server does not have (viewer %s)',
    async (viewer) => {
      const replyId = `${profileOwnerId}/statuses/context-reply-missing`
      await database.createNote({
        id: replyId,
        url: replyId,
        actorId: profileOwnerId,
        text: 'A reply to a missing post',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        reply: `${parentAuthorId}/statuses/never-stored`
      })
      const reply = (await database.getStatus({ statusId: replyId })) as Status

      expect(
        await getTimelineContext({
          database,
          currentActor: await viewerFor(viewer),
          statuses: [reply]
        })
      ).toEqual({ ancestorsById: {} })
    }
  )

  it('never walks past a parent the viewer may not read', async () => {
    // public grandparent <- followers-only parent <- public reply
    const grandparentId = `${parentAuthorId}/statuses/context-grandparent`
    await database.createNote({
      id: grandparentId,
      url: grandparentId,
      actorId: parentAuthorId,
      text: 'Public grandparent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const parentId = `${parentAuthorId}/statuses/context-hidden-middle`
    await database.createNote({
      id: parentId,
      url: parentId,
      actorId: parentAuthorId,
      text: 'Followers-only middle',
      to: [`${parentAuthorId}/followers`],
      cc: [],
      reply: grandparentId
    })
    const replyId = `${profileOwnerId}/statuses/context-under-hidden`
    await database.createNote({
      id: replyId,
      url: replyId,
      actorId: profileOwnerId,
      text: 'Public reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: parentId
    })
    const reply = (await database.getStatus({ statusId: replyId })) as Status

    expect(
      await getTimelineContext({
        database,
        currentActor: null,
        statuses: [reply]
      })
    ).toEqual({ ancestorsById: {} })
    expect(
      Object.keys(
        (
          await getTimelineContext({
            database,
            currentActor: await viewerFor('follower'),
            statuses: [reply]
          })
        ).ancestorsById
      )
    ).toEqual(expect.arrayContaining([parentId, grandparentId]))
  })
})
