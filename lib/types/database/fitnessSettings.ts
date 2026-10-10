import type { Visibility as MastodonVisibility } from '@/lib/types/mastodon/visibility'

export interface FitnessPrivacyLocationSettingsEntry {
  latitude: number
  longitude: number
  hideRadiusMeters: number
}

// Decrypted version for application use
export interface FitnessSettings {
  id: string
  actorId: string
  serviceType: string

  clientId?: string
  clientSecret?: string // Decrypted

  webhookToken?: string
  providerUserId?: string
  providerEnvironment?: 'sandbox' | 'production'
  grantedScopes?: string
  lastWebhookAt?: number
  lastImportAt?: number
  connectionError?: string
  credentialVersion?: number

  accessToken?: string // Decrypted
  refreshToken?: string // Decrypted
  tokenExpiresAt?: number

  oauthState?: string
  oauthStateExpiry?: number

  defaultVisibility?: MastodonVisibility

  // Privacy location settings
  privacyLocations?: FitnessPrivacyLocationSettingsEntry[]
  privacyHomeLatitude?: number
  privacyHomeLongitude?: number
  privacyHideRadiusMeters?: number

  // Route map description
  generateRouteDescription?: boolean

  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
