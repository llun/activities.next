import { Knex } from 'knex'
import { createHash } from 'node:crypto'

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
      // `err`, not `error`: an Error's message and stack are non-enumerable,
      // so `error` serializes to `{}` and the operator learns nothing. The
      // logger's own formatter reads `err.stack` to emit `stack_trace`.
      logger.error({
        message: 'Failed to parse stored fitness privacy locations',
        actorId: context.actorId,
        serviceType: context.serviceType,
        err: error
      })
      return []
    }
  }

  // Deliberately outside the try. `sanitizePrivacyLocationSettings` is total,
  // and if that ever stops being true the throw must surface rather than be
  // mislabelled as a parse failure and swallowed into "no privacy zones".
  return sanitizePrivacyLocationSettings(parsedValue)
}

const hashWebhookToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

const toFitnessSettings = (row: SQLFitnessSettings): FitnessSettings => ({
  id: row.id,
  actorId: row.actorId,
  serviceType: row.serviceType,
  clientId: row.clientId || undefined,
  clientSecret: row.clientSecret ? decrypt(row.clientSecret) : undefined,
  webhookToken:
    row.serviceType === 'wahoo'
      ? row.wahooWebhookToken
        ? decrypt(row.wahooWebhookToken)
        : undefined
      : row.webhookToken || undefined,
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
  providerUserId: row.providerUserId || undefined,
  providerEnvironment:
    row.providerEnvironment === 'production' ? 'production' : 'sandbox',
  grantedScopes: row.grantedScopes || undefined,
  lastWebhookAt: row.lastWebhookAt
    ? getCompatibleTime(row.lastWebhookAt)
    : undefined,
  lastImportAt: row.lastImportAt
    ? getCompatibleTime(row.lastImportAt)
    : undefined,
  connectionError: row.connectionError || undefined,
  credentialVersion: Number(row.credentialVersion ?? 0),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const FitnessSettingsSQLDatabaseMixin = (
  database: Knex
): FitnessSettingsDatabase => ({
  async createFitnessSettings({
    actorId,
    serviceType,
    clientId,
    clientSecret,
    webhookToken,
    providerUserId,
    providerEnvironment,
    grantedScopes,
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
      webhookToken: serviceType === 'wahoo' ? null : webhookToken,
      wahooWebhookToken:
        serviceType === 'wahoo' && webhookToken ? encrypt(webhookToken) : null,
      wahooWebhookTokenHash:
        serviceType === 'wahoo' && webhookToken
          ? hashWebhookToken(webhookToken)
          : null,
      providerUserId,
      providerEnvironment,
      grantedScopes,
      credentialVersion: 0,
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
      providerUserId,
      providerEnvironment,
      grantedScopes,
      credentialVersion: 0,
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
    expectedCredentialVersion,
    clientId,
    clientSecret,
    webhookToken,
    providerUserId,
    providerEnvironment,
    grantedScopes,
    lastWebhookAt,
    lastImportAt,
    connectionError,
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
    if (webhookToken !== undefined) {
      const existing = await database('fitness_settings')
        .where({ id })
        .whereNull('deletedAt')
        .first<SQLFitnessSettings>()
      if (existing?.serviceType === 'wahoo') {
        updateData.wahooWebhookToken = webhookToken
          ? encrypt(webhookToken)
          : null
        updateData.wahooWebhookTokenHash = webhookToken
          ? hashWebhookToken(webhookToken)
          : null
      } else {
        updateData.webhookToken = webhookToken || null
      }
    }
    if (providerUserId !== undefined) updateData.providerUserId = providerUserId
    if (providerEnvironment !== undefined)
      updateData.providerEnvironment = providerEnvironment
    if (grantedScopes !== undefined) updateData.grantedScopes = grantedScopes
    if (lastWebhookAt !== undefined)
      updateData.lastWebhookAt = lastWebhookAt ? new Date(lastWebhookAt) : null
    if (lastImportAt !== undefined)
      updateData.lastImportAt = lastImportAt ? new Date(lastImportAt) : null
    if (connectionError !== undefined)
      updateData.connectionError = connectionError
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

    const credentialEdit = clientId !== undefined || clientSecret !== undefined

    let updateQuery = database('fitness_settings')
      .where({ id })
      .whereNull('deletedAt')
    if (expectedCredentialVersion !== undefined) {
      updateQuery = updateQuery.where(
        'credentialVersion',
        expectedCredentialVersion
      )
    }
    const updated = await updateQuery.update({
      ...updateData,
      ...(credentialEdit
        ? { credentialVersion: database.raw('?? + 1', ['credentialVersion']) }
        : {})
    })
    if (updated !== 1) return null

    const row = await database('fitness_settings')
      .where({ id })
      .whereNull('deletedAt')
      .first<SQLFitnessSettings>()

    if (!row) return null

    return toFitnessSettings(row)
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

    return toFitnessSettings(row)
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

    return toFitnessSettings(row)
  },

  async getWahooSettingsByWebhookToken(
    token,
    providerUserId
  ): Promise<FitnessSettings | null> {
    const rows = await database('fitness_settings')
      .where({
        serviceType: 'wahoo',
        wahooWebhookTokenHash: hashWebhookToken(token),
        providerUserId
      })
      .whereNull('deletedAt')
      .limit(2)
      .select<SQLFitnessSettings[]>()
    return rows.length === 1 ? toFitnessSettings(rows[0]) : null
  },

  async consumeFitnessOauthState({ id, state, now }) {
    const updated = await database('fitness_settings')
      .where({ id, oauthState: state })
      .where('oauthStateExpiry', '>', new Date(now))
      .whereNull('deletedAt')
      .update({
        oauthState: null,
        oauthStateExpiry: null,
        updatedAt: new Date(now)
      })
    return updated === 1
  },

  async deleteFitnessSettings({
    actorId,
    serviceType
  }: DeleteFitnessSettingsParams): Promise<void> {
    await database('fitness_settings')
      .where({ actorId, serviceType })
      .update({
        deletedAt: new Date(),
        ...(serviceType === 'wahoo'
          ? {
              clientId: null,
              clientSecret: null,
              webhookToken: null,
              wahooWebhookToken: null,
              wahooWebhookTokenHash: null,
              accessToken: null,
              refreshToken: null,
              tokenExpiresAt: null,
              oauthState: null,
              oauthStateExpiry: null,
              providerUserId: null,
              grantedScopes: null
            }
          : {})
      })
  }
})
