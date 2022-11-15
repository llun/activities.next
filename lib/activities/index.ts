import memoize from 'lodash/memoize'
import { OrderedCollection, OrderedCollectionPage, Person } from './types'

const SHARED_HEADERS = {
  Accept: 'application/activity+json, application/ld+json'
}

export const getPerson = memoize(async (id: string) => {
  const response = await fetch(id, {
    headers: SHARED_HEADERS
  })
  if (response.status !== 200) return null

  const json: Person = await response.json()
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
    handle: json.preferredUsername,
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
})

export const getPosts = memoize(async (id?: string) => {
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
})