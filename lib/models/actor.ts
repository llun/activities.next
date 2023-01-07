import { Account } from './account'

export interface Profile {
  id: string
  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string
  createdAt: number
}

type ActorData = Profile & {
  privateKey?: string
  publicKey: string
  account?: Account
  updatedAt?: number
}

export class Actor {
  private data: ActorData

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
    return this.publicKey
  }

  get privateKey(): string {
    return this.privateKey
  }

  getMention(withDomain = false): string {
    if (!withDomain) {
      return `@${this.username}`
    }

    return `@${this.username}@${this.domain}`
  }

  toProfile(): Profile {
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
      createdAt: this.data.createdAt
    }
  }

  toJson(): Profile {
    return this.toProfile()
  }
}
