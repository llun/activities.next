import memoize from 'lodash/memoize'
import { getConfig } from '../config'
import { headers } from '../signature'
import { Actor } from '../models/actor'
import { Follow } from '../models/follow'
import { Person } from './entities/person'
import { OrderedCollection } from './entities/orderedCollection'
import { OrderedCollectionPage } from './entities/orderedCollectionPage'
import { FollowRequest } from './actions/follow'
import { UndoFollow } from './actions/undoFollow'
import { AcceptFollow } from './actions/acceptFollow'

const SHARED_HEADERS = {
  Accept: 'application/activity+json, application/ld+json'
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
    summary: json.summary,

    manuallyApprovesFollowers: json.manuallyApprovesFollowers,
    discoverable: json.discoverable,

    publicKey: json.publicKey.publicKeyPem,

    followersCount: followers?.totalItems || 0,
    followingCount: following?.totalItems || 0,
    totalPosts: posts?.totalItems || 0,

    urls: {
      followers: followers?.first,
      following: following?.first,
      posts: posts?.first
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
  return json.orderedItems.map((item) => ({
    actor: item.actor,
    id: item.object.id,
    url: item.object.url,
    content: item.object.content,
    createdAt: new Date(item.published).getTime()
  }))
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
    headers: headers(currentActor, 'post', `${targetActorId}/inbox`, content),
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
    headers: headers(
      currentActor,
      'post',
      `${follow.targetActorId}/inbox`,
      unfollowRequest
    ),
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
    headers: headers(
      currentActor,
      'post',
      `${followRequest.actor}/inbox`,
      acceptFollowRequest
    ),
    body: JSON.stringify(acceptFollowRequest)
  })
  return response.status === 202
}
