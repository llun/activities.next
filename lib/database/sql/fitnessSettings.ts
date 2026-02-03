import { Knex } from 'knex'
import { v4 as uuidv4 } from 'uuid'

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
}

export interface GetFitnessSettingsParams {
  actorId: string
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
    oauthStateExpiry
  }: CreateFitnessSettingsParams): Promise<FitnessSettings> {
    const id = uuidv4()
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
    oauthStateExpiry
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
