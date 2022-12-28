import { getConfig } from '../config'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { compact } from '../jsonld/index'
import { Actor } from '../models/actor'
import { Follow } from '../models/follow'
import { Status, StatusData } from '../models/status'
import { headers } from '../signature'
import { AcceptFollow } from './actions/acceptFollow'
import { CreateStatus } from './actions/createStatus'
import { DeleteStatus } from './actions/deleteStatus'
import { FollowRequest } from './actions/follow'
import { UndoFollow } from './actions/undoFollow'
import { Note } from './entities/note'
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

  try {
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
    const item = json.links.find((item) => item.rel === 'self')
    if (!item || !('href' in item)) return null
    return item.href
  } catch (error: any) {
    console.log(error.message)
    console.log(error.stack)
    return null
  }
}

export const getPerson = async (id: string, withCollectionCount = false) => {
  const response = await fetch(id, {
    headers: SHARED_HEADERS
  })
  if (response.status !== 200) return null

  const json = await response.json()
  const person: Person = (await compact(json)) as any

  if (!withCollectionCount) {
    return {
      id: person.id,
      username: person.preferredUsername,
      icon: person.icon,
      url: person.url,
      name: person.name,
      summary: person.summary,

      endpoints: {
        following: person.following,
        followers: person.followers,
        inbox: person.inbox,
        outbox: person.outbox,
        sharedInbox: person.endpoints?.sharedInbox
      },

      publicKey: person.publicKey.publicKeyPem,
      createdAt: new Date(person.published).getTime()
    }
  }

  const [followers, following, posts] = await Promise.all([
    fetch(person.followers, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    ),
    fetch(person.following, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    ),
    fetch(person.outbox, {
      headers: SHARED_HEADERS
    }).then((res) =>
      res.status === 200 ? (res.json() as Promise<OrderedCollection>) : null
    )
  ])

  return {
    id: person.id,
    username: person.preferredUsername,
    icon: person.icon,
    url: person.url,
    name: person.name,
    summary: person.summary,

    publicKey: person.publicKey.publicKeyPem,

    followersCount: followers?.totalItems || 0,
    followingCount: following?.totalItems || 0,
    totalPosts: posts?.totalItems || 0,

    endpoints: {
      following: person.following,
      followers: person.followers,
      inbox: person.inbox,
      outbox: person.outbox,
      sharedInbox: person.endpoints?.sharedInbox
    },

    urls: {
      followers:
        typeof followers?.first !== 'string'
          ? followers?.first?.id
          : followers?.first,
      following:
        typeof following?.first !== 'string'
          ? following?.first?.id
          : following?.first,
      posts: typeof posts?.first !== 'string' ? posts?.first?.id : posts?.first
    },

    createdAt: new Date(person.published).getTime()
  }
}

export const getPersonFromHandle = async (
  account: string,
  withCollectionCount = false
) => {
  const accountWithoutAt = account.startsWith('@') ? account.slice(1) : account
  const id = await getWebfingerSelf(accountWithoutAt)
  if (!id) return null

  return getPerson(id, withCollectionCount)
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

      return Status.fromNote(item.object).toJson()
    })
    .filter((item): item is StatusData => item !== null)
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
  const activity: CreateStatus = {
    '@context': ACTIVITY_STREAM_PUBLIC,
    id: `${note.id}/activity`,
    type: 'Create',
    actor: note.attributedTo,
    published: note.published,
    to: note.to,
    cc: note.cc,
    object: note
  }
  // TODO: Add LinkedDataSignature later
  // https://github.com/mastodon/mastodon/blob/48e136605a30fa7ee71a656b599d91adf47b17fc/app/lib/activitypub/linked_data_signature.rb#L3
  try {
    await fetch(inbox, {
      method: 'POST',
      headers: {
        ...headers(currentActor, 'post', inbox, activity),
        'User-Agent': USER_AGENT
      },
      body: JSON.stringify(activity)
    })
  } catch (error: any) {
    // Ignore fail fetch
    console.error({ error: error.message, inbox, activity })
  }
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
  const activity: DeleteStatus = {
    '@context': ACTIVITY_STREAM_URL,
    id: `${statusId}#delete`,
    type: 'Delete',
    actor: currentActor.id,
    to: [ACTIVITY_STREAM_PUBLIC],
    object: {
      id: statusId,
      type: 'Tombstone'
    }
  }
  try {
    await fetch(inbox, {
      method: 'POST',
      headers: {
        ...headers(currentActor, 'post', inbox, activity),
        'User-Agent': USER_AGENT
      },
      body: JSON.stringify(activity)
    })
  } catch (error: any) {
    // Ignore fail fetch
    console.error({ error: error.message, inbox, activity })
  }
}

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) => {
  const config = getConfig()
  const content: FollowRequest = {
    '@context': ACTIVITY_STREAM_URL,
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
    '@context': ACTIVITY_STREAM_URL,
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
