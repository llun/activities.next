export interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  manuallyApprovesFollowers?: boolean
  emailNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
  }
}

export type ActorDeletionStatus = 'scheduled' | 'deleting' | null

export interface SQLActor {
  id: string
  username: string
  domain: string
  name?: string
  summary?: string
  accountId: string

  publicKey: string
  privateKey: string

  settings: string | ActorSettings

  deletionStatus?: ActorDeletionStatus
  deletionScheduledAt?: number | Date | null

  createdAt: number | Date
  updatedAt: number | Date
}

export interface SQLAccount {
  id: string
  email: string
  passwordHash?: string | null
  verificationCode?: string | null
  emailChangePending?: string | null
  emailChangeCode?: string | null
  emailChangeCodeExpiresAt?: number | Date | null
  emailVerifiedAt?: number | Date | null

  createdAt: number | Date
  updatedAt: number | Date
  verifiedAt?: number | Date
}
