import { Note } from '@llun/activities.schema'
import crypto from 'crypto'

import { Actor, ActorProfile } from '@/lib/models/actor'
import { Follow } from '@/lib/models/follow'
import {
  Status,
  StatusAnnounce,
  StatusData,
  StatusNote,
  StatusType
} from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { compact } from '@/lib/utils/jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/jsonld/activitystream'
import { request } from '@/lib/utils/request'
import { signedHeaders } from '@/lib/utils/signature'
import { getSpan, getTracer } from '@/lib/utils/trace'

import { getNoteFromStatusData } from '../utils/getNoteFromStatusData'
import { logger } from '../utils/logger'
import { AcceptFollow } from './actions/acceptFollow'
import { AnnounceStatus } from './actions/announceStatus'
import { CreateStatus } from './actions/createStatus'
import { DeleteStatus } from './actions/deleteStatus'
import { FollowRequest } from './actions/follow'
import { LikeStatus } from './actions/like'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from './actions/types'
import { UndoFollow } from './actions/undoFollow'
import { UndoLike } from './actions/undoLike'
import { UndoStatus } from './actions/undoStatus'
import { UpdateStatus } from './actions/updateStatus'
import { Image } from './entities/image'
import {
  OrderedCollection,
  getOrderCollectionFirstPage
} from './entities/orderedCollection'
import { OrderedCollectionPage } from './entities/orderedCollectionPage'
import { Person } from './entities/person'
import { WebFinger } from './types'

const DEFAULT_ACCEPT = 'application/activity+json, application/ld+json'

export const getWebfingerSelf = async (account: string) => {
  const [user, domain] = account.split('@')
  if (!user || !domain) return null
  const span = getSpan('activities', 'getWebfingerSelf', { account })
  try {
    const { statusCode, body } = await request({
      url: `https://${domain}/.well-known/webfinger?resource=acct:${account}`,
      headers: {
        Accept: 'application/json'
      }
    })
    if (statusCode !== 200) {
      return null
    }

    const json = JSON.parse(body) as WebFinger
    const item = json.links.find((item) => item.rel === 'self')
    if (!item || !('href' in item)) {
      return null
    }
    return item.href
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    span.recordException(nodeError)
    logger.error(`[getWebfingerSelf] ${nodeError.message}`)
    return null
  } finally {
    span.end()
  }
}

// TODO: Remove PublicProfile and use Profile in model
export interface PublicProfile {
  id: string
  username: string
  domain: string
  icon?: Image
  url: string
  name: string
  summary: string

  endpoints: {
    following: string
    followers: string
    inbox: string
    outbox: string
    sharedInbox: string
  }

  urls?: {
    followers: string | null
    following: string | null
    posts: string | null
  }

  publicKey?: string

  followersCount: number
  followingCount: number
  totalPosts: number

  createdAt: number
}

export interface GetPublicProfileParams {
  actorId: string
  withCollectionCount?: boolean
  withPublicKey?: boolean
}
export const getPublicProfile = async ({
  actorId,
  withCollectionCount = false,
  withPublicKey = false
}: GetPublicProfileParams): Promise<PublicProfile | null> =>
  getTracer().startActiveSpan(
    'activities.getPublicProfile',
    {
      attributes: { actorId, withCollectionCount, withPublicKey }
    },
    async (span) => {
      try {
        const { statusCode, body } = await request({
          url: actorId,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (statusCode !== 200) {
          span.end()
          return null
        }

        const data = JSON.parse(body)
        const person: Person = (await compact(data)) as Person

        if (!withCollectionCount) {
          span.end()
          return {
            id: person.id,
            username: person.preferredUsername,
            domain: new URL(person.id).hostname,
            ...(person.icon ? { icon: person.icon } : null),
            url: person.url,
            name: person.name || '',
            summary: person.summary || '',

            followersCount: 0,
            followingCount: 0,
            totalPosts: 0,

            ...(withPublicKey
              ? { publicKey: person.publicKey.publicKeyPem }
              : null),

            endpoints: {
              following: person.following,
              followers: person.followers,
              inbox: person.inbox,
              outbox: person.outbox,
              sharedInbox: person.endpoints?.sharedInbox ?? person.inbox
            },

            createdAt: new Date(person.published).getTime()
          }
        }

        const [followers, following, posts] = await Promise.all([
          person.followers
            ? request({
                url: person.followers,
                headers: { Accept: DEFAULT_ACCEPT }
              }).then((res) =>
                res.statusCode === 200
                  ? (JSON.parse(res.body) as Promise<OrderedCollection>)
                  : null
              )
            : null,
          person.following
            ? request({
                url: person.following,
                headers: { Accept: DEFAULT_ACCEPT }
              }).then((res) =>
                res.statusCode === 200
                  ? (JSON.parse(res.body) as Promise<OrderedCollection>)
                  : null
              )
            : null,
          person.outbox
            ? request({
                url: person.outbox,
                headers: { Accept: DEFAULT_ACCEPT }
              }).then((res) =>
                res.statusCode === 200
                  ? (JSON.parse(res.body) as Promise<OrderedCollection>)
                  : null
              )
            : null
        ])

        return {
          id: person.id,
          username: person.preferredUsername,
          domain: new URL(person.id).hostname,
          ...(person.icon ? { icon: person.icon } : null),
          url: person.url ?? person.id,
          name: person.name || '',
          summary: person.summary || '',

          ...(withPublicKey
            ? { publicKey: person.publicKey.publicKeyPem }
            : null),

          followersCount: followers?.totalItems || 0,
          followingCount: following?.totalItems || 0,
          totalPosts: posts?.totalItems || 0,

          endpoints: {
            following: person?.following ?? null,
            followers: person?.followers ?? null,
            inbox: person.inbox,
            outbox: person?.outbox ?? null,
            sharedInbox: person.endpoints?.sharedInbox ?? person.outbox
          },

          urls: {
            followers: getOrderCollectionFirstPage(followers),
            following: getOrderCollectionFirstPage(following),
            posts: getOrderCollectionFirstPage(posts)
          },

          createdAt: new Date(person.published).getTime()
        }
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getPublicProfile] ${nodeError.message}`)
        return null
      } finally {
        span.end()
      }
    }
  )

export const getPublicProfileFromHandle = async (
  account: string,
  withCollectionCount = false
) =>
  getTracer().startActiveSpan(
    'activities.getPublicProfileFromHandle',
    { attributes: { account, withCollectionCount } },
    async (span) => {
      const accountWithoutAt = account.startsWith('@')
        ? account.slice(1)
        : account
      const actorId = await getWebfingerSelf(accountWithoutAt)
      if (!actorId) {
        span.end()
        return null
      }

      const publicProfile = await getPublicProfile({
        actorId,
        withCollectionCount
      })
      span.end()
      return publicProfile
    }
  )

interface GetActorFromIdParams {
  actorId: string
}
export const getActorProfileFromPublicProfile = async ({
  actorId
}: GetActorFromIdParams) =>
  getTracer().startActiveSpan(
    'activities.getActorProfileFromPublicProfile',
    { attributes: { actorId } },
    async (span) => {
      const publicProfile = await getPublicProfile({
        actorId,
        withPublicKey: true
      })
      if (!publicProfile) {
        span.end()
        return null
      }

      const actor: ActorProfile = {
        id: publicProfile.id,
        username: publicProfile.username,
        domain: publicProfile.domain,
        name: publicProfile.name,
        summary: publicProfile.summary,
        iconUrl: publicProfile.icon?.url || '',

        inboxUrl: publicProfile.endpoints.inbox,
        sharedInboxUrl: publicProfile.endpoints.sharedInbox,
        followersUrl: publicProfile.endpoints.followers,

        followersCount: publicProfile.followersCount,
        followingCount: publicProfile.followingCount,

        statusCount: publicProfile.totalPosts,
        lastStatusAt: 0,

        createdAt: publicProfile.createdAt
      }
      span.end()
      return actor
    }
  )

interface GetActorPostsParams {
  postsUrl?: string | null
}
export const getActorPosts = async ({ postsUrl }: GetActorPostsParams) =>
  getTracer().startActiveSpan(
    'activities.getActorPosts',
    { attributes: { postsUrl: postsUrl ?? '' } },
    async () => {
      if (!postsUrl) return []
      const span = getSpan('activities', 'getActorPosts', {
        postsUrl
      })

      try {
        const { statusCode, body } = await request({
          url: postsUrl,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (statusCode !== 200) {
          span.end()
          return []
        }

        const json: OrderedCollectionPage = JSON.parse(body)
        const items = json.orderedItems || []

        const statusData = await Promise.all(
          items.map(async (item) => {
            if (item.type === AnnounceAction) {
              const note = await getStatus({ statusId: item.object })
              if (!note) return null
              const originalStatus = Status.fromNote(note)
              return Status.fromAnnoucne(
                item,
                originalStatus.data as StatusNote
              ).toJson()
            }

            // Unsupported activity
            if (item.type !== CreateAction) return null
            // Unsupported Object
            if (item.object.type !== 'Note') return null

            return Status.fromNote(item.object).toJson()
          })
        )

        return statusData.filter((item): item is StatusData => item !== null)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getActorPosts] ${nodeError.message}`)
        return []
      } finally {
        span.end()
      }
    }
  )

interface GetStatusParams {
  statusId: string
}
export const getStatus = async ({
  statusId
}: GetStatusParams): Promise<Note | null> =>
  getTracer().startActiveSpan(
    'activities.getStatus',
    { attributes: { statusId } },
    async (span) => {
      try {
        const { statusCode, body } = await request({
          url: statusId,
          headers: { Accept: DEFAULT_ACCEPT }
        })
        if (statusCode !== 200) return null
        return JSON.parse(body)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getStatus] ${nodeError.message}`)
        return null
      } finally {
        span.end()
      }
    }
  )

interface SendNoteParams {
  currentActor: Actor
  inbox: string
  note: Note
}
export const sendNote = async ({ currentActor, inbox, note }: SendNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: CreateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: note.id,
        type: CreateAction,
        actor: note.attributedTo,
        published: note.published,
        to: note.to,
        cc: note.cc,
        object: note
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendNote] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface SendUpdateNoteParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendUpdateNote = async ({
  currentActor,
  inbox,
  status
}: SendUpdateNoteParams) =>
  getTracer().startActiveSpan(
    'activities.sendUpdateNote',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const note = getNoteFromStatusData(status.data)
      if (!note) {
        span.end()
        return
      }

      const activity: UpdateStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${note.id}#updates/${Date.now()}`,
        type: UpdateAction,
        actor: note.attributedTo,
        published: getISOTimeUTC(status.updatedAt),
        to: note.to,
        cc: note.cc,
        object: note
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendUpdateNote] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface SendAnnounceParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendAnnounce = async ({
  currentActor,
  inbox,
  status
}: SendAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.sendAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      if (status.data.type !== StatusType.enum.Announce) {
        span.end()
        return null
      }

      const activity: AnnounceStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${status.id}/activity`,
        type: AnnounceAction,
        actor: status.actorId,
        published: getISOTimeUTC(status.createdAt),
        to: status.to,
        cc: status.cc,
        object: status.data.originalStatus.id
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendAnnounce] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface DeleteStatusParams {
  currentActor: Actor
  inbox: string
  statusId: string
}
export const deleteStatus = async ({
  currentActor,
  inbox,
  statusId
}: DeleteStatusParams) =>
  getTracer().startActiveSpan(
    'activities.deleteStatus',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: DeleteStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${statusId}#delete`,
        type: DeleteAction,
        actor: currentActor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: {
          id: statusId,
          type: 'Tombstone'
        }
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[deleteStatus] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface UndoAnnounceParams {
  currentActor: Actor
  inbox: string
  announce: StatusAnnounce
}
export const undoAnnounce = async ({
  currentActor,
  inbox,
  announce
}: UndoAnnounceParams) =>
  getTracer().startActiveSpan(
    'activities.undoAnnounce',
    {
      attributes: {
        actorId: currentActor.id,
        inbox
      }
    },
    async (span) => {
      const activity: UndoStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${announce.id}#undo`,
        type: UndoAction,
        actor: currentActor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: {
          id: `${announce.id}/activity`,
          type: AnnounceAction,
          actor: announce.actorId,
          published: getISOTimeUTC(announce.createdAt),
          to: announce.to,
          cc: announce.cc,
          object: announce.originalStatus.id
        }
      }
      const method = 'POST'
      try {
        await request({
          url: inbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              inbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[undoAnnounce] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) =>
  getTracer().startActiveSpan(
    'activities.follow',
    {
      attributes: {
        id,
        actorId: currentActor.id,
        targetActorId
      }
    },
    async (span) => {
      const activity: FollowRequest = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${id}`,
        type: 'Follow',
        actor: currentActor.id,
        object: targetActorId
      }
      const publicProfile = await getPublicProfile({ actorId: targetActorId })
      const targetInbox = publicProfile?.endpoints.inbox
      if (!targetInbox) {
        span.end()
        return false
      }

      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: targetInbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              targetInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[follow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

export const unfollow = async (currentActor: Actor, follow: Follow) =>
  getTracer().startActiveSpan(
    'activities.unfollow',
    {
      attributes: {
        actorId: currentActor.id,
        follow: follow.id
      }
    },
    async (span) => {
      const activity: UndoFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `https://${currentActor.domain}/${currentActor.id}#follows/${follow.id}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `https://${currentActor.domain}/${follow.id}`,
          type: 'Follow',
          actor: follow.actorId,
          object: follow.targetActorId
        }
      }

      const publicProfile = await getPublicProfile({
        actorId: follow.targetActorId
      })
      const targetInbox =
        publicProfile?.endpoints.inbox ?? `${follow.targetActorId}/inbox`

      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: targetInbox,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              targetInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          method,
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[unfollow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

export const acceptFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) =>
  getTracer().startActiveSpan(
    'activities.acceptFollow',
    {
      attributes: {
        actorId: currentActor.id,
        followingInbox
      }
    },
    async (span) => {
      const activity: AcceptFollow = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#accepts/followers`,
        type: 'Accept',
        actor: currentActor.id,
        object: {
          id: followRequest.id,
          type: 'Follow',
          actor: followRequest.actor,
          object: followRequest.object
        }
      }
      const method = 'POST'
      try {
        const { statusCode } = await request({
          url: followingInbox,
          method,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              followingInbox,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
        return statusCode === 202
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[acceptFollow] ${nodeError.message}`)
        return false
      } finally {
        span.end()
      }
    }
  )

const statusIdHash = (statusId: string) =>
  crypto.createHash('md5').update(statusId).digest('hex')

interface LikeParams {
  currentActor: Actor
  status: Status
}
export const sendLike = async ({ currentActor, status }: LikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: LikeStatus = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}#likes/${statusIdHash(status.id)}`,
        type: 'Like',
        actor: currentActor.id,
        object: status.id
      }
      const method = 'POST'
      try {
        await request({
          method,
          url: status.actor.inboxUrl,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              status.actor.inboxUrl,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendLike] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )

interface UndoLikeParams {
  currentActor: Actor
  status: Status
}
export const sendUndoLike = async ({ currentActor, status }: UndoLikeParams) =>
  getTracer().startActiveSpan(
    'activities.sendUndoLike',
    { attributes: { actorId: currentActor.id, statusId: status.id } },
    async (span) => {
      if (!status.actor) return

      const activity: UndoLike = {
        '@context': ACTIVITY_STREAM_URL,
        id: `${currentActor.id}/#likes/${statusIdHash(status.id)}/undo`,
        type: 'Undo',
        actor: currentActor.id,
        object: {
          id: `${currentActor.id}/#likes/${statusIdHash(status.id)}`,
          type: 'Like',
          actor: currentActor.id,
          object: status.id
        }
      }
      const method = 'POST'
      try {
        await request({
          method,
          url: status.actor.inboxUrl,
          headers: {
            ...signedHeaders(
              currentActor,
              method.toLowerCase(),
              status.actor.inboxUrl,
              activity
            ),
            Accept: DEFAULT_ACCEPT
          },
          body: JSON.stringify(activity)
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[sendUndoLike] ${nodeError.message}`)
      } finally {
        span.end()
      }
    }
  )
