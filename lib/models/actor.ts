import { getISOTimeUTC } from '../time'
import { Account } from './account'

export interface ActorProfile {
  id: string
  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string

  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string

  createdAt: number
}

export type ActorData = ActorProfile & {
  privateKey?: string
  publicKey: string
  account?: Account
  updatedAt: number
}

export class Actor {
  readonly data: ActorData

  constructor(data: ActorData) {
    this.data = data
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

      createdAt: this.data.createdAt
    }
  }

  toMastodonModel() {
    return {
      id: this.data.id,
      username: this.data.username,
      acct: `${this.data.username}@${this.data.domain}`,
      display_name: this.data.name ?? '',
      locked: false,
      bot: false,
      created_at: getISOTimeUTC(this.data.createdAt),
      note: '',
      url: this.data.id,
      avatar: this.data.iconUrl ?? '',
      avatar_static: this.data.iconUrl ?? '',
      header: this.data.headerImageUrl ?? '',
      header_static: this.data.headerImageUrl ?? '',
      // Below are unsupported properties
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      last_status_at: '',
      emojis: [],
      fields: []
    }
  }

  toJson(): ActorProfile {
    return this.toProfile()
  }
}
