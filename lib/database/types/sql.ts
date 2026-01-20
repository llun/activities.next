export interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  manuallyApprovesFollowers?: boolean
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
  defaultActorId?: string | null
  defaultActorDomain?: string | null

  createdAt: number | Date
  updatedAt: number | Date
  verifiedAt?: number | Date
}
