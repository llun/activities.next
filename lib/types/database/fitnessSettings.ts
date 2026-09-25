import type { Visibility as MastodonVisibility } from '@/lib/types/mastodon/visibility'

export interface FitnessPrivacyLocationSettingsEntry {
  latitude: number
  longitude: number
  hideRadiusMeters: number
}

// SQL row type for fitness_settings table
export interface SQLFitnessSettings {
  id: string
  actorId: string
  serviceType: 'strava' | 'garmin' | string

  // OAuth credentials (nullable)
  clientId?: string | null
  clientSecret?: string | null // Encrypted

  // Webhook
  webhookToken?: string | null
  wahooWebhookToken?: string | null
  wahooWebhookTokenHash?: string | null
  providerUserId?: string | null
  providerEnvironment?: string | null
  grantedScopes?: string | null
  lastWebhookAt?: number | Date | null
  lastImportAt?: number | Date | null
  connectionError?: string | null
  credentialVersion: number

  // OAuth tokens (encrypted)
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: number | Date | null

  // OAuth flow state (temporary)
  oauthState?: string | null
  oauthStateExpiry?: number | Date | null

  // Default post visibility for imported activities
  defaultVisibility?: MastodonVisibility | null

  // Privacy location settings
  privacyLocations?: FitnessPrivacyLocationSettingsEntry[] | string | null
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number | null

  // Route map description
  generateRouteDescription?: boolean | null

  // Timestamps
  createdAt: number | Date
  updatedAt: number | Date
  deletedAt?: number | Date | null
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
