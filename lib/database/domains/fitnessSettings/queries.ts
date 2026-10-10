import { type Selectable, type Updateable } from 'kysely'
import { createHmac } from 'node:crypto'

import { getConfig } from '@/lib/config'
import type {
  CreateFitnessSettingsParams,
  DeleteFitnessSettingsParams,
  GetFitnessSettingsByWebhookTokenParams,
  GetFitnessSettingsParams,
  UpdateFitnessSettingsParams
} from '@/lib/database/domains/fitnessSettings/types'
import type { Db } from '@/lib/database/kysely'
import type { FitnessSettings as FitnessSettingsTable } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { sanitizePrivacyLocationSettings } from '@/lib/services/fitness-files/privacy'
import {
  FitnessPrivacyLocationSettingsEntry,
  FitnessSettings
} from '@/lib/types/database/fitnessSettings'
import { Visibility as MastodonVisibilitySchema } from '@/lib/types/mastodon/visibility'
import { decrypt, encrypt } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'

type Row = Selectable<FitnessSettingsTable>

export const parseStoredPrivacyLocations = (
  value: unknown,
  context: { actorId: string; serviceType: string }
): FitnessPrivacyLocationSettingsEntry[] | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  // The driver parses the `json`/`jsonb` column on both backends, so a string
  // only arrives when the stored text is not JSON (hand-written data), or is a
  // JSON-encoded string holding JSON. Both are parsed once more here.
  let parsedValue: unknown = value
  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value) as unknown
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
  createHmac('sha256', getConfig().secretPhase)
    .update('wahoo-webhook-token-v1:')
    .update(token)
    .digest('hex')

const toFitnessSettings = (row: Row): FitnessSettings => ({
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
  tokenExpiresAt: row.tokenExpiresAt ?? undefined,
  oauthState: row.oauthState || undefined,
  oauthStateExpiry: row.oauthStateExpiry ?? undefined,
  // Written only through MastodonVisibilitySchema.parse(); the column is a
  // plain varchar, so the read side narrows it back.
  defaultVisibility:
    (row.defaultVisibility as FitnessSettings['defaultVisibility']) ||
    undefined,
  privacyLocations: parseStoredPrivacyLocations(row.privacyLocations, {
    actorId: row.actorId,
    serviceType: row.serviceType
  }),
  privacyHomeLatitude: row.privacyHomeLatitude ?? undefined,
  privacyHomeLongitude: row.privacyHomeLongitude ?? undefined,
  privacyHideRadiusMeters: row.privacyHideRadiusMeters ?? undefined,
  generateRouteDescription: row.generateRouteDescription,
  providerUserId: row.providerUserId || undefined,
  providerEnvironment:
    row.providerEnvironment === 'production' ? 'production' : 'sandbox',
  grantedScopes: row.grantedScopes || undefined,
  lastWebhookAt: row.lastWebhookAt ?? undefined,
  lastImportAt: row.lastImportAt ?? undefined,
  connectionError: row.connectionError || undefined,
  credentialVersion: row.credentialVersion,
  // Nullable in the schema, but every writer sets them.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0,
  deletedAt: row.deletedAt ?? undefined
})

export const createFitnessSettings = async (
  db: Db,
  {
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
    privacyHideRadiusMeters,
    generateRouteDescription
  }: CreateFitnessSettingsParams
): Promise<FitnessSettings> => {
  const existing = await db
    .selectFrom('fitness_settings')
    .select('id')
    .where('actorId', '=', actorId)
    .where('serviceType', '=', serviceType)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

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

  await db
    .insertInto('fitness_settings')
    .values({
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
      generateRouteDescription: generateRouteDescription ?? false,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()

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
    generateRouteDescription: generateRouteDescription ?? false,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
}

export const updateFitnessSettings = async (
  db: Db,
  {
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
    privacyHideRadiusMeters,
    generateRouteDescription
  }: UpdateFitnessSettingsParams
): Promise<FitnessSettings | null> => {
  const updateData: Updateable<FitnessSettingsTable> = {
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
    const existing = await db
      .selectFrom('fitness_settings')
      .select('serviceType')
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst()
    if (existing?.serviceType === 'wahoo') {
      updateData.wahooWebhookToken = webhookToken ? encrypt(webhookToken) : null
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
    updateData.tokenExpiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : null
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
  if (generateRouteDescription !== undefined)
    updateData.generateRouteDescription = generateRouteDescription ?? false

  const credentialEdit = clientId !== undefined || clientSecret !== undefined

  const { numUpdatedRows } = await db
    .updateTable('fitness_settings')
    .set((eb) => ({
      ...updateData,
      ...(credentialEdit
        ? { credentialVersion: eb('credentialVersion', '+', 1) }
        : {})
    }))
    .where('id', '=', id)
    .where('deletedAt', 'is', null)
    .$if(expectedCredentialVersion !== undefined, (qb) =>
      qb.where('credentialVersion', '=', expectedCredentialVersion!)
    )
    .executeTakeFirst()
  if (Number(numUpdatedRows) !== 1) return null

  const row = await db
    .selectFrom('fitness_settings')
    .selectAll()
    .where('id', '=', id)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null

  return toFitnessSettings(row)
}

export const getFitnessSettings = async (
  db: Db,
  { actorId, serviceType }: GetFitnessSettingsParams
): Promise<FitnessSettings | null> => {
  const row = await db
    .selectFrom('fitness_settings')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('serviceType', '=', serviceType)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null

  return toFitnessSettings(row)
}

export const getFitnessSettingsByWebhookToken = async (
  db: Db,
  { webhookToken, serviceType }: GetFitnessSettingsByWebhookTokenParams
): Promise<FitnessSettings | null> => {
  const row = await db
    .selectFrom('fitness_settings')
    .selectAll()
    .where('webhookToken', '=', webhookToken)
    .where('serviceType', '=', serviceType)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null

  return toFitnessSettings(row)
}

export const getWahooSettingsByWebhookToken = async (
  db: Db,
  token: string,
  providerUserId: string
): Promise<FitnessSettings | null> => {
  // Two rows would mean the (hash, provider user) binding is ambiguous, so the
  // token resolves to no settings at all.
  const rows = await db
    .selectFrom('fitness_settings')
    .selectAll()
    .where('serviceType', '=', 'wahoo')
    .where('wahooWebhookTokenHash', '=', hashWebhookToken(token))
    .where('providerUserId', '=', providerUserId)
    .where('deletedAt', 'is', null)
    .limit(2)
    .execute()
  return rows.length === 1 ? toFitnessSettings(rows[0]) : null
}

export const consumeFitnessOauthState = async (
  db: Db,
  { id, state, now }: { id: string; state: string; now: number }
): Promise<boolean> => {
  const { numUpdatedRows } = await db
    .updateTable('fitness_settings')
    .set({
      oauthState: null,
      oauthStateExpiry: null,
      updatedAt: new Date(now)
    })
    .where('id', '=', id)
    .where('oauthState', '=', state)
    .where('oauthStateExpiry', '>', timestampValue(now))
    .where('deletedAt', 'is', null)
    .executeTakeFirst()
  return Number(numUpdatedRows) === 1
}

export const deleteFitnessSettings = async (
  db: Db,
  { actorId, serviceType }: DeleteFitnessSettingsParams
): Promise<void> => {
  await db
    .updateTable('fitness_settings')
    .set({
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
    .where('actorId', '=', actorId)
    .where('serviceType', '=', serviceType)
    .execute()
}

export const fitnessSettingsQueries = {
  createFitnessSettings,
  updateFitnessSettings,
  getFitnessSettings,
  getFitnessSettingsByWebhookToken,
  getWahooSettingsByWebhookToken,
  consumeFitnessOauthState,
  deleteFitnessSettings
}
