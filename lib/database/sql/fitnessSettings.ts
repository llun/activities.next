import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessSettings,
  SQLFitnessSettings
} from '@/lib/types/database/fitnessSettings'
import { decrypt, encrypt } from '@/lib/utils/crypto'

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
    privacyHomeLatitude,
    privacyHomeLongitude,
    privacyHideRadiusMeters
  }: UpdateFitnessSettingsParams): Promise<FitnessSettings | null> {
    const updateData: Partial<SQLFitnessSettings> = {
      updatedAt: new Date()
    }

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
