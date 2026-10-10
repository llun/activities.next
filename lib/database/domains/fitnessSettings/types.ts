// Parameter types of the fitness settings domain. The decrypted
// `FitnessSettings` result type lives in lib/types/database/fitnessSettings.ts;
// the stored row type is the generated `FitnessSettings` table type in
// lib/database/kysely/db.ts.
import type {
  FitnessPrivacyLocationSettingsEntry,
  FitnessSettings
} from '@/lib/types/database/fitnessSettings'

export interface CreateFitnessSettingsParams {
  actorId: string
  serviceType: string
  clientId?: string
  clientSecret?: string
  webhookToken?: string
  providerUserId?: string
  providerEnvironment?: 'sandbox' | 'production'
  grantedScopes?: string
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
  oauthState?: string
  oauthStateExpiry?: number
  defaultVisibility?: FitnessSettings['defaultVisibility']
  privacyLocations?: FitnessPrivacyLocationSettingsEntry[]
  privacyHomeLatitude?: number
  privacyHomeLongitude?: number
  privacyHideRadiusMeters?: number
  generateRouteDescription?: boolean
}

export interface UpdateFitnessSettingsParams {
  id: string
  expectedCredentialVersion?: number
  clientId?: string | null
  clientSecret?: string | null
  webhookToken?: string | null
  providerUserId?: string | null
  providerEnvironment?: 'sandbox' | 'production' | null
  grantedScopes?: string | null
  lastWebhookAt?: number | null
  lastImportAt?: number | null
  connectionError?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: number | null
  oauthState?: string | null
  oauthStateExpiry?: number | null
  defaultVisibility?: FitnessSettings['defaultVisibility'] | null
  privacyLocations?: FitnessPrivacyLocationSettingsEntry[] | null
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number | null
  generateRouteDescription?: boolean | null
}

export interface GetFitnessSettingsParams {
  actorId: string
  serviceType: string
}

export interface GetFitnessSettingsByWebhookTokenParams {
  webhookToken: string
  serviceType: string
}

export interface DeleteFitnessSettingsParams {
  actorId: string
  serviceType: string
}

export interface FitnessSettingsDatabase {
  createFitnessSettings: (
    params: CreateFitnessSettingsParams
  ) => Promise<FitnessSettings>
  updateFitnessSettings: (
    params: UpdateFitnessSettingsParams
  ) => Promise<FitnessSettings | null>
  getFitnessSettings: (
    params: GetFitnessSettingsParams
  ) => Promise<FitnessSettings | null>
  getFitnessSettingsByWebhookToken: (
    params: GetFitnessSettingsByWebhookTokenParams
  ) => Promise<FitnessSettings | null>
  getWahooSettingsByWebhookToken: (
    token: string,
    providerUserId: string
  ) => Promise<FitnessSettings | null>
  consumeFitnessOauthState: (params: {
    id: string
    state: string
    now: number
  }) => Promise<boolean>
  deleteFitnessSettings: (params: DeleteFitnessSettingsParams) => Promise<void>
}
