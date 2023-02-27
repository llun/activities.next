import * as Sentry from '@sentry/nextjs'
import crypto from 'crypto'
import got, { Headers, Method } from 'got'

import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { compact } from '../jsonld/index'
import { Actor, ActorProfile } from '../models/actor'
import { Follow } from '../models/follow'
import {
  Status,
  StatusAnnounce,
  StatusData,
  StatusNote,
  StatusType
} from '../models/status'
import { signedHeaders } from '../signature'
import { getISOTimeUTC } from '../time'
import { getSpan } from '../trace'
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
  UndoAction
} from './actions/types'
import { UndoFollow } from './actions/undoFollow'
import { UndoLike } from './actions/undoLike'
import { UndoStatus } from './actions/undoStatus'
import { Image } from './entities/image'
import { Note } from './entities/note'
import {
  OrderedCollection,
  getOrderCollectionFirstPage
} from './entities/orderedCollection'
import { OrderedCollectionPage } from './entities/orderedCollectionPage'
import { Person } from './entities/person'
import { WebFinger } from './types'

const USER_AGENT = 'activities.next/0.1'
const DEFAULT_RESPONSE_TIMEOUT = 4000
const MAX_RETRY_LIMIT = 1

const SHARED_HEADERS = {
  Accept: 'application/activity+json, application/ld+json',
  'User-Agent': USER_AGENT
}

export interface RequestOptions {
  url: string
  method?: Method
  headers?: Headers
  body?: string
  responseTimeout?: number
}

export const request = ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout = DEFAULT_RESPONSE_TIMEOUT
}: RequestOptions) => {
  return got(url, {
    headers: {
      ...SHARED_HEADERS,
      ...headers
    },
    timeout: {
      response: responseTimeout
    },
    retry: {
      limit: MAX_RETRY_LIMIT
    },
    method,
    body
  })
}

export const getWebfingerSelf = async (account: string) => {
  const [user, domain] = account.split('@')
  if (!user || !domain) return null
  const span = getSpan('activities', 'getWebfingerSelf', { account })
  try {
    const response = await fetch(
      `https://${domain}/.well-known/webfinger?resource=acct:${account}`,
      {
        headers: {
          Accept: 'application/json'
        }
      }
    )
    if (response.status !== 200) {
      span?.finish()
      return null
    }

    const json = (await response.json()) as WebFinger
    const item = json.links.find((item) => item.rel === 'self')
    span?.finish()
    if (!item || !('href' in item)) {
      return null
    }
    return item.href
  } catch (error) {
    Sentry.captureException(error)
    span?.finish()
    return null
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
}: GetPublicProfileParams): Promise<PublicProfile | null> => {
  const span = getSpan('activities', 'getPublicProfile', {
    actorId,
    withCollectionCount,
    withPublicKey
  })

  const { statusCode, body } = await request({ url: actorId })
  if (statusCode !== 200) {
    span?.finish()
    return null
  }

  const data = JSON.parse(body)
  const person: Person = (await compact(data)) as Person

  if (!withCollectionCount) {
    span?.finish()
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

      ...(withPublicKey ? { publicKey: person.publicKey.publicKeyPem } : null),

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
    request({ url: person.followers }).then((res) =>
      res.statusCode === 200
        ? (JSON.parse(res.body) as Promise<OrderedCollection>)
        : null
    ),
    request({ url: person.following }).then((res) =>
      res.statusCode === 200
        ? (JSON.parse(res.body) as Promise<OrderedCollection>)
        : null
    ),
    request({ url: person.outbox }).then((res) =>
      res.statusCode === 200
        ? (JSON.parse(res.body) as Promise<OrderedCollection>)
        : null
    )
  ])

  span?.finish()
  return {
    id: person.id,
    username: person.preferredUsername,
    domain: new URL(person.id).hostname,
    ...(person.icon ? { icon: person.icon } : null),
    url: person.url,
    name: person.name || '',
    summary: person.summary || '',

    ...(withPublicKey ? { publicKey: person.publicKey.publicKeyPem } : null),

    followersCount: followers?.totalItems || 0,
    followingCount: following?.totalItems || 0,
    totalPosts: posts?.totalItems || 0,

    endpoints: {
      following: person.following,
      followers: person.followers,
      inbox: person.inbox,
      outbox: person.outbox,
      sharedInbox: person.endpoints?.sharedInbox ?? person.outbox
    },

    urls: {
      followers: getOrderCollectionFirstPage(followers),
      following: getOrderCollectionFirstPage(following),
      posts: getOrderCollectionFirstPage(posts)
    },

    createdAt: new Date(person.published).getTime()
  }
}

export const getPublicProfileFromHandle = async (
  account: string,
  withCollectionCount = false
) => {
  const accountWithoutAt = account.startsWith('@') ? account.slice(1) : account
  const actorId = await getWebfingerSelf(accountWithoutAt)
  if (!actorId) return null

  return getPublicProfile({ actorId, withCollectionCount })
}

interface GetActorFromIdParams {
  actorId: string
}
export const getActorProfileFromPublicProfile = async ({
  actorId
}: GetActorFromIdParams) => {
  const publicProfile = await getPublicProfile({ actorId, withPublicKey: true })
  if (!publicProfile) return null

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

    createdAt: publicProfile.createdAt
  }
  return actor
}

interface GetActorPostsParams {
  postsUrl?: string | null
}
export const getActorPosts = async ({ postsUrl }: GetActorPostsParams) => {
  if (!postsUrl) return []
  const span = getSpan('activities', 'getActorPosts', {
    postsUrl
  })

  const { statusCode, body } = await request({ url: postsUrl })
  if (statusCode !== 200) {
    span?.finish()
    return []
  }

  const json: OrderedCollectionPage = JSON.parse(body)
  const statusData = await Promise.all(
    json.orderedItems.map(async (item) => {
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

  span?.finish()
  return statusData.filter((item): item is StatusData => item !== null)
}

interface GetStatusParams {
  statusId: string
}
export const getStatus = async ({
  statusId
}: GetStatusParams): Promise<Note | null> => {
  const span = getSpan('activities', 'getStatus', {
    statusId
  })
  const { statusCode, body } = await request({ url: statusId })
  span?.finish()
  if (statusCode !== 200) return null
  return JSON.parse(body)
}

interface SendNoteParams {
  currentActor: Actor
  inbox: string
  note: Note
}
export const sendNote = async ({
  currentActor,
  inbox,
  note
}: SendNoteParams) => {
  const span = getSpan('activities', 'sendNote', {
    actorId: currentActor.id,
    inbox
  })
  const activity: CreateStatus = {
    '@context': ACTIVITY_STREAM_URL,
    id: `${note.id}/activity`,
    type: CreateAction,
    actor: note.attributedTo,
    published: note.published,
    to: note.to,
    cc: note.cc,
    object: note
  }
  const method = 'POST'
  await request({
    url: inbox,
    method,
    headers: {
      ...signedHeaders(currentActor, method.toLowerCase(), inbox, activity),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
}

interface SendAnnounceParams {
  currentActor: Actor
  inbox: string
  status: Status
}
export const sendAnnounce = async ({
  currentActor,
  inbox,
  status
}: SendAnnounceParams) => {
  if (status.data.type !== StatusType.Announce) {
    return null
  }

  const span = getSpan('activities', 'sendAnnounce', {
    actorId: currentActor.id,
    inbox
  })
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
  await request({
    url: inbox,
    headers: {
      ...signedHeaders(currentActor, method.toLowerCase(), inbox, activity),
      'User-Agent': USER_AGENT
    },
    method,
    body: JSON.stringify(activity)
  })
  span?.finish()
}

interface DeleteStatusParams {
  currentActor: Actor
  inbox: string
  statusId: string
}
export const deleteStatus = async ({
  currentActor,
  inbox,
  statusId
}: DeleteStatusParams) => {
  const span = getSpan('activities', 'deleteStatus', {
    actorId: currentActor.id,
    inbox
  })
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
  await request({
    url: inbox,
    headers: {
      ...signedHeaders(currentActor, method.toLowerCase(), inbox, activity),
      'User-Agent': USER_AGENT
    },
    method,
    body: JSON.stringify(activity)
  })
  span?.finish()
}

interface UndoAnnounceParams {
  currentActor: Actor
  inbox: string
  announce: StatusAnnounce
}
export const undoAnnounce = async ({
  currentActor,
  inbox,
  announce
}: UndoAnnounceParams) => {
  const span = getSpan('activities', 'undoAnnounce', {
    actorId: currentActor.id,
    inbox
  })
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
  await request({
    url: inbox,
    method,
    headers: {
      ...signedHeaders(currentActor, method.toLowerCase(), inbox, activity),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
}

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) => {
  const span = getSpan('activities', 'follow', {
    id,
    actorId: currentActor.id,
    targetActorId
  })
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
    span?.finish()
    return false
  }

  const method = 'POST'
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
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
  return statusCode === 202
}

export const unfollow = async (currentActor: Actor, follow: Follow) => {
  const span = getSpan('activities', 'unfollow', {
    actorId: currentActor.id,
    follow: follow.id
  })
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
  const { statusCode } = await request({
    url: targetInbox,
    headers: {
      ...signedHeaders(
        currentActor,
        method.toLowerCase(),
        targetInbox,
        activity
      ),
      'User-Agent': USER_AGENT
    },
    method,
    body: JSON.stringify(activity)
  })
  span?.finish()
  return statusCode === 202
}

export const acceptFollow = async (
  currentActor: Actor,
  followingInbox: string,
  followRequest: FollowRequest
) => {
  const span = getSpan('activities', 'acceptFollow', {
    actorId: currentActor.id,
    followingInbox
  })
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
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
  return statusCode === 202
}

const statusIdHash = (statusId: string) =>
  crypto.createHash('md5').update(statusId).digest('hex')

interface LikeParams {
  currentActor: Actor
  status: Status
}
export const sendLike = async ({ currentActor, status }: LikeParams) => {
  if (!status.actor) return

  const span = getSpan('activities', 'sendLike', {
    actorId: currentActor.id,
    statusId: status.id
  })

  const activity: LikeStatus = {
    '@context': ACTIVITY_STREAM_URL,
    id: `${currentActor.id}#likes/${statusIdHash(status.id)}`,
    type: 'Like',
    actor: currentActor.id,
    object: status.id
  }
  const method = 'POST'
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
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
}

interface UndoLikeParams {
  currentActor: Actor
  status: Status
}
export const sendUndoLike = async ({
  currentActor,
  status
}: UndoLikeParams) => {
  if (!status.actor) return

  const span = getSpan('activities', 'undoLike', {
    actorId: currentActor.id,
    statusId: status.id
  })

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
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
  span?.finish()
}
