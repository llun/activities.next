import { getConfig } from '../config'
import { Actor } from '../models/actor'
import { Follow } from '../models/follow'
import { Status, fromJson, toObject } from '../models/status'
import { headers } from '../signature'
import { getISOTimeUTC } from '../time'
import { AcceptFollow } from './actions/acceptFollow'
import { CreateStatus } from './actions/createStatus'
import { FollowRequest } from './actions/follow'
import { UndoFollow } from './actions/undoFollow'
import { OutboxContext } from './context'
import { Mention } from './entities/mention'
import { OrderedCollection } from './entities/orderedCollection'
import { OrderedCollectionPage } from './entities/orderedCollectionPage'
import { Person } from './entities/person'
import { WebFinger } from './types'

const USER_AGENT = 'activities.next/0.1'

const SHARED_HEADERS = {
  Accept: 'application/activity+json, application/ld+json',
  'User-Agent': USER_AGENT
}

export const getWebfingerSelf = async (account: string) => {
  const [user, domain] = account.split('@')
  if (!user || !domain) return null

  const response = await fetch(
    `https://${domain}/.well-known/webfinger?resource=acct:${account}`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) return null

  const json = (await response.json()) as WebFinger
  console.log(json)
  const item = json.links.find((item) => item.rel === 'self')
  if (!item || !('href' in item)) return null
  return item.href
}

export const getPerson = async (id: string, withCollectionCount: boolean) => {
  const response = await fetch(id, {
    headers: SHARED_HEADERS
  })
  if (response.status !== 200) return null

  const json: Person = await response.json()
  if (!withCollectionCount) {
    return {
      id: json.id,
      username: json.preferredUsername,
      icon: json.icon,
      url: json.url,
      name: json.name,
      summary: json.summary,

      manuallyApprovesFollowers: json.manuallyApprovesFollowers,
      discoverable: json.discoverable,

      publicKey: json.publicKey.publicKeyPem,
      createdAt: new Date(json.published).getTime()
    }
  }

  const [followers, following, posts] = await Promise.all([
    fetch(json.followers, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    ),
    fetch(json.following, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    ),
    fetch(json.outbox, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    )
  ])

  return {
    id: json.id,
    username: json.preferredUsername,
    icon: json.icon,
    url: json.url,
    name: json.name,
    summary: json.summary,

    manuallyApprovesFollowers: json.manuallyApprovesFollowers,
    discoverable: json.discoverable,

    publicKey: json.publicKey.publicKeyPem,

    followersCount: followers?.totalItems || 0,
    followingCount: following?.totalItems || 0,
    totalPosts: posts?.totalItems || 0,

    urls: {
      followers:
        typeof followers?.first !== 'string'
          ? followers?.first.id
          : followers?.first,
      following:
        typeof following?.first !== 'string'
          ? following?.first.id
          : following?.first,
      posts: typeof posts?.first !== 'string' ? posts?.first.id : posts?.first
    },

    createdAt: new Date(json.published).getTime()
  }
}

export const getPosts = async (id?: string) => {
  if (!id) return []

  const response = await fetch(id, {
    headers: SHARED_HEADERS
  })
  if (response.status !== 200) return []

  const json: OrderedCollectionPage = await response.json()
  return json.orderedItems
    .map((item) => {
      // Unsupported activity
      if (item.type !== 'Create') return null
      // Unsupported Object
      if (item.object.type !== 'Note') return null

      return fromJson(item.object)
    })
    .filter((item): item is Status => item !== null)
}

export const sendNote = async (
  currentActor: Actor,
  sharedInbox: string,
  status: Status,
  mentions: Mention[] = []
) => {
  const published = getISOTimeUTC(status.createdAt)
  const activity: CreateStatus = {
    '@context': OutboxContext,
    id: `${status.id}/activity`,
    type: 'Create',
    actor: status.actorId,
    published,
    to: status.to,
    cc: status.cc,
    object: toObject({ status, mentions })
  }
  // TODO: Add LinkedDataSignature later
  // https://github.com/mastodon/mastodon/blob/48e136605a30fa7ee71a656b599d91adf47b17fc/app/lib/activitypub/linked_data_signature.rb#L3
  await fetch(sharedInbox, {
    method: 'POST',
    headers: {
      ...headers(currentActor, 'post', sharedInbox, activity),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(activity)
  })
}

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) => {
  const config = getConfig()
  const content: FollowRequest = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${config.host}/${id}`,
    type: 'Follow',
    actor: currentActor.id,
    object: targetActorId
  }
  const response = await fetch(`${targetActorId}/inbox`, {
    method: 'POST',
    headers: {
      ...headers(currentActor, 'post', `${targetActorId}/inbox`, content),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(content)
  })
  return response.status === 202
}

export const unfollow = async (currentActor: Actor, follow: Follow) => {
  const config = getConfig()
  const unfollowRequest: UndoFollow = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${config.host}/${currentActor.id}#follows/${follow.id}/undo`,
    type: 'Undo',
    actor: currentActor.id,
    object: {
      id: `https://${config.host}/${follow.id}`,
      type: 'Follow',
      actor: follow.actorId,
      object: follow.targetActorId
    }
  }
  const response = await fetch(`${follow.targetActorId}/inbox`, {
    method: 'POST',
    headers: {
      ...headers(
        currentActor,
        'post',
        `${follow.targetActorId}/inbox`,
        unfollowRequest
      ),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(unfollowRequest)
  })
  return response.status === 202
}

export const acceptFollow = async (
  currentActor: Actor,
  followRequest: FollowRequest
) => {
  const acceptFollowRequest: AcceptFollow = {
    '@context': 'https://www.w3.org/ns/activitystreams',
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
  const response = await fetch(`${followRequest.actor}/inbox`, {
    method: 'POST',
    headers: {
      ...headers(
        currentActor,
        'post',
        `${followRequest.actor}/inbox`,
        acceptFollowRequest
      ),
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify(acceptFollowRequest)
  })
  return response.status === 202
}
