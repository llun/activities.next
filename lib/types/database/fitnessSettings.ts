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

  // OAuth tokens (encrypted)
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: number | Date | null

  // OAuth flow state (temporary)
  oauthState?: string | null
  oauthStateExpiry?: number | Date | null

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

  accessToken?: string // Decrypted
  refreshToken?: string // Decrypted
  tokenExpiresAt?: number

  oauthState?: string
  oauthStateExpiry?: number

  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
