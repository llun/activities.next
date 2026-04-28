import { type ActorType } from '@/lib/types/domain/actor'

// SQL row types - Types returned directly from database queries

export const POST_LINE_LIMIT_VALUES = [5, 10, 0] as const
export type PostLineLimit = (typeof POST_LINE_LIMIT_VALUES)[number]

export interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  manuallyApprovesFollowers?: boolean
  postLineLimit?: PostLineLimit
  emailNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    activity_import?: boolean
  }
  pushNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    activity_import?: boolean
  }
}

export type ActorDeletionStatus = 'scheduled' | 'deleting' | null

export interface SQLActor {
  id: string
  type?: ActorType
  username: string
  domain: string
  name?: string
  summary?: string
  accountId: string | null

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
  name?: string | null
  iconUrl?: string | null
  passwordHash?: string | null
  verificationCode?: string | null
  passwordResetCode?: string | null
  passwordResetCodeExpiresAt?: number | Date | null
  emailChangePending?: string | null
  emailChangeCode?: string | null
  emailChangeCodeExpiresAt?: number | Date | null
  emailVerifiedAt?: number | Date | null
  twoFactorEnabled?: boolean | number | null
  role?: string | null

  createdAt: number | Date
  updatedAt: number | Date
  verifiedAt?: number | Date
}

export interface SQLDomainFederationRule {
  id: string
  domain: string
  type: string
  severity?: string | null
  rejectMedia: boolean | number
  rejectReports: boolean | number
  privateComment?: string | null
  publicComment?: string | null
  obfuscate: boolean | number
  source?: string | null
  createdAt: number | Date
  updatedAt: number | Date
}
