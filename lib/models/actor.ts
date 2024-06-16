import { z } from 'zod'

import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'
import { W3ID_URL } from '@/lib/utils/jsonld/w3id'

import { PublicProfile } from '../activities'
import { Image } from '../activities/entities/image'
import { Person } from '../activities/entities/person'
import { Account } from './account'

export const ActorProfile = z.object({
  id: z.string(),
  username: z.string(),
  domain: z.string(),
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  appleSharedAlbumToken: z.string().optional(),

  followersUrl: z.string(),
  inboxUrl: z.string(),
  sharedInboxUrl: z.string(),

  followingCount: z.number(),
  followersCount: z.number(),

  createdAt: z.number()
})

export type ActorProfile = z.infer<typeof ActorProfile>

export const ActorData = ActorProfile.extend({
  privateKey: z.string().optional(),
  publicKey: z.string(),
  account: Account.optional(),
  updatedAt: z.number()
})

export type ActorData = z.infer<typeof ActorData>

export class Actor {
  readonly data: ActorData

  constructor(data: ActorData) {
    this.data = ActorData.parse(data)
  }

  get id(): string {
    return this.data.id
  }

  get name(): string {
    return this.data.name || ''
  }

  get summary(): string {
    return this.data.summary || ''
  }

  get username(): string {
    return this.data.username
  }

  get domain(): string {
    return this.data.domain
  }

  get iconUrl(): string {
    return this.data.iconUrl || ''
  }

  get headerImageUrl(): string {
    return this.data.headerImageUrl || ''
  }

  get appleSharedAlbumToken(): string {
    return this.data.appleSharedAlbumToken || ''
  }

  get publicKey(): string {
    return this.data.publicKey
  }

  get privateKey(): string {
    return this.data.privateKey || ''
  }

  get inboxUrl(): string {
    return this.data.inboxUrl
  }

  get sharedInboxUrl(): string {
    return this.data.sharedInboxUrl
  }

  get followersUrl(): string {
    return this.data.followersUrl
  }

  get account(): Account | undefined {
    return this.data.account
  }

  get createdAt(): number {
    return this.data.createdAt
  }

  static getMentionHostnameFromId(actorId: string) {
    const url = new URL(actorId)
    return `@${url.hostname}`
  }

  static getMentionFromId(actorId: string, withDomain = false): string {
    try {
      // This method assume that all actor id has a username in the end,
      // however this might not be true especially for Misskey.io that use
      // random id in the actor id instead of username.
      const id = actorId.split('/').pop()
      if (!withDomain) {
        return `@${id}`
      }

      return `@${id}${Actor.getMentionHostnameFromId(actorId)}`
    } catch {
      console.error(`Fail to split the actor id, (${JSON.stringify(actorId)})`)
      return actorId
    }
  }

  static getMentionFromProfile(
    profile: ActorProfile,
    withDomain = true
  ): string {
    if (!withDomain) {
      return `@${profile.username}`
    }

    return `@${profile.username}@${profile.domain}`
  }

  getMention(withDomain = false): string {
    if (!withDomain) {
      return `@${this.username}`
    }

    return `@${this.username}@${this.domain}`
  }

  getActorPage(withDomain = false): string {
    return `https://${this.domain}/${this.getMention(withDomain)}`
  }

  toProfile(): ActorProfile {
    return {
      id: this.data.id,
      username: this.data.username,
      domain: this.data.domain,
      ...(this.data.name ? { name: this.data.name } : null),
      ...(this.data.domain ? { domain: this.data.domain } : null),
      ...(this.data.summary ? { summary: this.data.summary } : null),
      ...(this.data.iconUrl ? { iconUrl: this.data.iconUrl } : null),
      ...(this.data.headerImageUrl
        ? { headerImageUrl: this.data.headerImageUrl }
        : null),
      ...(this.data.appleSharedAlbumToken
        ? { appleSharedAlbumToken: this.data.appleSharedAlbumToken }
        : null),

      followersUrl: this.data.followersUrl ?? '',
      inboxUrl: this.data.inboxUrl ?? '',
      sharedInboxUrl: this.data.sharedInboxUrl ?? '',

      followersCount: this.data.followersCount,
      followingCount: this.data.followingCount,

      createdAt: this.data.createdAt
    }
  }

  toPerson(): Person {
    const icon = this.data.iconUrl
      ? {
          icon: {
            type: 'Image',
            mediaType: 'image/jpeg',
            url: this.data.iconUrl
          } as Image
        }
      : null
    const headerImage = this.data.headerImageUrl
      ? {
          image: {
            type: 'Image',
            mediaType: 'image/png',
            url: this.data.headerImageUrl
          } as Image
        }
      : null

    return {
      '@context': [ACTIVITY_STREAM_URL, W3ID_URL],
      id: this.data.id,
      type: 'Person',
      following: `https://${this.data.domain}/users/${this.data.username}/following`,
      followers: `https://${this.data.domain}/users/${this.data.username}/followers`,
      inbox: `https://${this.data.domain}/users/${this.data.username}/inbox`,
      outbox: `https://${this.data.domain}/users/${this.data.username}/outbox`,
      preferredUsername: this.data.username,
      name: this.data.name || '',
      summary: this.data.summary || '',
      url: `https://${this.data.domain}/@${this.data.username}`,
      published: getISOTimeUTC(this.data.createdAt),
      publicKey: {
        id: `${this.data.id}#main-key`,
        owner: this.data.id,
        publicKeyPem: this.data.publicKey
      },
      endpoints: {
        sharedInbox: `https://${this.data.domain}/inbox`
      },
      ...icon,
      ...headerImage
    }
  }

  toPublicProfile(params?: {
    followingCount: number
    followersCount: number
    totalPosts: number
  }): PublicProfile {
    const person = this.toPerson()
    const { followersCount, followingCount, totalPosts } = params ?? {
      followersCount: 0,
      followingCount: 0,
      totalPosts: 0
    }
    return {
      id: person.id,
      username: person.preferredUsername,
      domain: new URL(person.id).hostname,
      ...(person.icon ? { icon: person.icon } : null),
      url: person.url,
      name: person.name || '',
      summary: person.summary || '',

      followersCount,
      followingCount,
      totalPosts,

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

  toJson(): ActorProfile {
    return this.toProfile()
  }
}
