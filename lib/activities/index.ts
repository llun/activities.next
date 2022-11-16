import memoize from 'lodash/memoize'
import crypto from 'crypto'
import { OrderedCollection, OrderedCollectionPage, Person } from './types'
import { getConfig } from '../config'
import { sign } from '../signature'
import { Actor } from '../models/actor'

const SHARED_HEADERS = {
  Accept: 'application/activity+json, application/ld+json'
}

export const getPerson = memoize(
  async (id: string, withCollectionCount: boolean) => {
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
)

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

export const follow = async (
  id: string,
  currentActor: Actor,
  targetActorId: string
) => {
  const config = getConfig()
  const content = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${config.host}/${id}`,
    type: 'Follow',
    actor: currentActor.id,
    object: targetActorId
  }
  const url = new URL(targetActorId)
  const digest = `SHA-256=${crypto
    .createHash('sha-256')
    .update(JSON.stringify(content))
    .digest('base64')}`
  const host = url.host
  const contentType = 'application/activity+json'
  const date = new Date().toUTCString()

  const headers = {
    host,
    date,
    digest,
    'content-type': contentType
  }
  const signature = await sign(
    `(request-target): post ${url.pathname}/inbox`,
    headers,
    currentActor.privateKey
  )
  const signatureHeader = `keyId="${currentActor.id}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="${signature}"`
  const response = await fetch(`${targetActorId}/inbox`, {
    method: 'POST',
    headers: {
      ...headers,
      signature: signatureHeader
    },
    body: JSON.stringify(content)
  })
  console.log(response.status)
  const t = await response.text()
  console.log(t)
}

export const unfollow = async (currentActor: Actor, targetActorId: string) => {}
