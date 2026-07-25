import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { sanitizePrivacyLocationSettings } from '@/lib/services/fitness-files/privacy'
import {
  FitnessPrivacyLocationSettingsEntry,
  FitnessSettings,
  SQLFitnessSettings
} from '@/lib/types/database/fitnessSettings'
import { Visibility as MastodonVisibilitySchema } from '@/lib/types/mastodon/visibility'
import { decrypt, encrypt } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'

export interface CreateFitnessSettingsParams {
  actorId: string
  serviceType: string
  clientId?: string
  clientSecret?: string
  webhookToken?: string
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
}

export interface UpdateFitnessSettingsParams {
  id: string
  clientId?: string | null
  clientSecret?: string | null
  webhookToken?: string | null
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
  deleteFitnessSettings: (params: DeleteFitnessSettingsParams) => Promise<void>
}

export const parseStoredPrivacyLocations = (
  value: SQLFitnessSettings['privacyLocations'],
  context: { actorId: string; serviceType: string }
): FitnessPrivacyLocationSettingsEntry[] | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  // SQLite hands back the `json` column as TEXT; PostgreSQL `jsonb` arrives
  // already parsed, so only the string branch needs a parse at all.
  let parsedValue: unknown = value
  if (typeof value === 'string') {
    try {
      parsedValue = getCompatibleJSON<unknown>(value)
    } catch (error) {
      // Returning [] here means "no privacy zones", which republishes every
      // route segment those zones were hiding. That must never happen
      // silently: an operator needs to see it and restore the column.
      logger.error({
        message: 'Failed to parse stored fitness privacy locations',
        actorId: context.actorId,
        serviceType: context.serviceType,
        error
      })
      return []
    }
  }

  // Deliberately outside the try. `sanitizePrivacyLocationSettings` is total,
  // and if that ever stops being true the throw must surface rather than be
  // mislabelled as a parse failure and swallowed into "no privacy zones".
  return sanitizePrivacyLocationSettings(parsedValue)
}

export const FitnessSettingsSQLDatabaseMixin = (
  database: Knex
): FitnessSettingsDatabase => ({
  async createFitnessSettings({
    actorId,
    serviceType,
    clientId,
    clientSecret,
    webhookToken,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    oauthState,
    oauthStateExpiry,
    defaultVisibility,
    privacyLocations,
    privacyHomeLatitude,
    privacyHomeLongitude,
    privacyHideRadiusMeters
  }: CreateFitnessSettingsParams): Promise<FitnessSettings> {
    const existing = await database('fitness_settings')
      .where({ actorId, serviceType })
      .whereNull('deletedAt')
      .first()

    if (existing) {
      throw new Error(
        `Fitness settings already exist for actor ${actorId} and service ${serviceType}`
      )
    }

    const id = crypto.randomUUID()
    const currentTime = new Date()
    const sanitizedPrivacyLocations = sanitizePrivacyLocationSettings(
      privacyLocations ?? []
    )

    const row: Partial<SQLFitnessSettings> = {
      id,
      actorId,
      serviceType,
      clientId,
      clientSecret: clientSecret ? encrypt(clientSecret) : null,
      webhookToken,
      accessToken: accessToken ? encrypt(accessToken) : null,
      refreshToken: refreshToken ? encrypt(refreshToken) : null,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      oauthState,
      oauthStateExpiry: oauthStateExpiry ? new Date(oauthStateExpiry) : null,
      defaultVisibility: defaultVisibility
        ? MastodonVisibilitySchema.parse(defaultVisibility)
        : null,
      privacyLocations: JSON.stringify(sanitizedPrivacyLocations),
      privacyHomeLatitude,
      privacyHomeLongitude,
      privacyHideRadiusMeters,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    await database('fitness_settings').insert(row)

    return {
      id,
      actorId,
      serviceType,
      clientId,
      clientSecret,
      webhookToken,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      oauthState,
      oauthStateExpiry,
      defaultVisibility,
      privacyLocations: sanitizedPrivacyLocations,
      privacyHomeLatitude,
      privacyHomeLongitude,
      privacyHideRadiusMeters,
      createdAt: getCompatibleTime(currentTime),
      updatedAt: getCompatibleTime(currentTime)
    }
  },

  async updateFitnessSettings({
    id,
    clientId,
    clientSecret,
    webhookToken,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    oauthState,
    oauthStateExpiry,
    defaultVisibility,
    privacyLocations,
    privacyHomeLatitude,
    privacyHomeLongitude,
    privacyHideRadiusMeters
  }: UpdateFitnessSettingsParams): Promise<FitnessSettings | null> {
    const updateData: Partial<SQLFitnessSettings> = {
      updatedAt: new Date()
    }
    const sanitizedPrivacyLocations =
      privacyLocations === undefined
        ? undefined
        : sanitizePrivacyLocationSettings(privacyLocations ?? [])

    if (clientId !== undefined) updateData.clientId = clientId || null
    if (clientSecret !== undefined)
      updateData.clientSecret = clientSecret ? encrypt(clientSecret) : null
    if (webhookToken !== undefined)
      updateData.webhookToken = webhookToken || null
    if (accessToken !== undefined)
      updateData.accessToken = accessToken ? encrypt(accessToken) : null
    if (refreshToken !== undefined)
      updateData.refreshToken = refreshToken ? encrypt(refreshToken) : null
    if (tokenExpiresAt !== undefined)
      updateData.tokenExpiresAt = tokenExpiresAt
        ? new Date(tokenExpiresAt)
        : null
    if (oauthState !== undefined) updateData.oauthState = oauthState || null
    if (oauthStateExpiry !== undefined)
      updateData.oauthStateExpiry = oauthStateExpiry
        ? new Date(oauthStateExpiry)
        : null
    if (defaultVisibility !== undefined) {
      updateData.defaultVisibility = defaultVisibility
        ? MastodonVisibilitySchema.parse(defaultVisibility)
        : null
    }
    if (sanitizedPrivacyLocations !== undefined) {
      updateData.privacyLocations = JSON.stringify(sanitizedPrivacyLocations)
    }
    if (privacyHomeLatitude !== undefined)
      updateData.privacyHomeLatitude = privacyHomeLatitude
    if (privacyHomeLongitude !== undefined)
      updateData.privacyHomeLongitude = privacyHomeLongitude
    if (privacyHideRadiusMeters !== undefined)
      updateData.privacyHideRadiusMeters = privacyHideRadiusMeters

    await database('fitness_settings').where({ id }).update(updateData)

    const row = await database('fitness_settings')
      .where({ id })
      .whereNull('deletedAt')
      .first<SQLFitnessSettings>()

    if (!row) return null

    return {
      id: row.id,
      actorId: row.actorId,
      serviceType: row.serviceType,
      clientId: row.clientId || undefined,
      clientSecret: row.clientSecret ? decrypt(row.clientSecret) : undefined,
      webhookToken: row.webhookToken || undefined,
      accessToken: row.accessToken ? decrypt(row.accessToken) : undefined,
      refreshToken: row.refreshToken ? decrypt(row.refreshToken) : undefined,
      tokenExpiresAt: row.tokenExpiresAt
        ? getCompatibleTime(row.tokenExpiresAt)
        : undefined,
      oauthState: row.oauthState || undefined,
      oauthStateExpiry: row.oauthStateExpiry
        ? getCompatibleTime(row.oauthStateExpiry)
        : undefined,
      defaultVisibility: row.defaultVisibility || undefined,
      privacyLocations: parseStoredPrivacyLocations(row.privacyLocations, {
        actorId: row.actorId,
        serviceType: row.serviceType
      }),
      privacyHomeLatitude: row.privacyHomeLatitude ?? undefined,
      privacyHomeLongitude: row.privacyHomeLongitude ?? undefined,
      privacyHideRadiusMeters: row.privacyHideRadiusMeters ?? undefined,
      createdAt: getCompatibleTime(row.createdAt),
      updatedAt: getCompatibleTime(row.updatedAt),
      deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
    }
  },

  async getFitnessSettings({
    actorId,
    serviceType
  }: GetFitnessSettingsParams): Promise<FitnessSettings | null> {
    const row = await database('fitness_settings')
      .where({ actorId, serviceType })
      .whereNull('deletedAt')
      .first<SQLFitnessSettings>()

    if (!row) return null

    return {
      id: row.id,
      actorId: row.actorId,
      serviceType: row.serviceType,
      clientId: row.clientId || undefined,
      clientSecret: row.clientSecret ? decrypt(row.clientSecret) : undefined,
      webhookToken: row.webhookToken || undefined,
      accessToken: row.accessToken ? decrypt(row.accessToken) : undefined,
      refreshToken: row.refreshToken ? decrypt(row.refreshToken) : undefined,
      tokenExpiresAt: row.tokenExpiresAt
        ? getCompatibleTime(row.tokenExpiresAt)
        : undefined,
      oauthState: row.oauthState || undefined,
      oauthStateExpiry: row.oauthStateExpiry
        ? getCompatibleTime(row.oauthStateExpiry)
        : undefined,
      defaultVisibility: row.defaultVisibility || undefined,
      privacyLocations: parseStoredPrivacyLocations(row.privacyLocations, {
        actorId: row.actorId,
        serviceType: row.serviceType
      }),
      privacyHomeLatitude: row.privacyHomeLatitude ?? undefined,
      privacyHomeLongitude: row.privacyHomeLongitude ?? undefined,
      privacyHideRadiusMeters: row.privacyHideRadiusMeters ?? undefined,
      createdAt: getCompatibleTime(row.createdAt),
      updatedAt: getCompatibleTime(row.updatedAt),
      deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
    }
  },

  async getFitnessSettingsByWebhookToken({
    webhookToken,
    serviceType
  }: GetFitnessSettingsByWebhookTokenParams): Promise<FitnessSettings | null> {
    const row = await database('fitness_settings')
      .where({ webhookToken, serviceType })
      .whereNull('deletedAt')
      .first<SQLFitnessSettings>()

    if (!row) return null

    return {
      id: row.id,
      actorId: row.actorId,
      serviceType: row.serviceType,
      clientId: row.clientId || undefined,
      clientSecret: row.clientSecret ? decrypt(row.clientSecret) : undefined,
      webhookToken: row.webhookToken || undefined,
      accessToken: row.accessToken ? decrypt(row.accessToken) : undefined,
      refreshToken: row.refreshToken ? decrypt(row.refreshToken) : undefined,
      tokenExpiresAt: row.tokenExpiresAt
        ? getCompatibleTime(row.tokenExpiresAt)
        : undefined,
      oauthState: row.oauthState || undefined,
      oauthStateExpiry: row.oauthStateExpiry
        ? getCompatibleTime(row.oauthStateExpiry)
        : undefined,
      defaultVisibility: row.defaultVisibility || undefined,
      privacyLocations: parseStoredPrivacyLocations(row.privacyLocations, {
        actorId: row.actorId,
        serviceType: row.serviceType
      }),
      privacyHomeLatitude: row.privacyHomeLatitude ?? undefined,
      privacyHomeLongitude: row.privacyHomeLongitude ?? undefined,
      privacyHideRadiusMeters: row.privacyHideRadiusMeters ?? undefined,
      createdAt: getCompatibleTime(row.createdAt),
      updatedAt: getCompatibleTime(row.updatedAt),
      deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
    }
  },

  async deleteFitnessSettings({
    actorId,
    serviceType
  }: DeleteFitnessSettingsParams): Promise<void> {
    await database('fitness_settings')
      .where({ actorId, serviceType })
      .update({ deletedAt: new Date() })
  }
})
