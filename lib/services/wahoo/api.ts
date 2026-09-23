import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

const API_BASE = 'https://api.wahooligan.com'
export const WAHOO_OAUTH_SCOPES = 'user_read workouts_read offline_data'

export class WahooRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Wahoo rate limit reached')
  }
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional()
})

const IdSchema = z.union([z.number().int(), z.string().min(1)])
export const WahooUserSchema = z.object({ id: IdSchema })
export const WahooSummarySchema = z.object({
  id: IdSchema,
  updated_at: z.string().optional(),
  duration_total_accum: z.string().nullable().optional(),
  file: z.object({ url: z.string().url().optional() }).nullable().optional()
})
export const WahooWorkoutSchema = z.object({
  id: IdSchema,
  starts: z.string().nullable().optional(),
  minutes: z.number().optional(),
  name: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  workout_summary: WahooSummarySchema.nullable().optional()
})
const WorkoutsPageSchema = z.object({
  workouts: z.array(WahooWorkoutSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  per_page: z.number().int().positive()
})

export type WahooWorkout = z.infer<typeof WahooWorkoutSchema>

const tokenRequest = async (body: URLSearchParams) => {
  const response = await safeRemoteFetch({
    url: `${API_BASE}/oauth/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    maxBodyBytes: 100_000
  })
  if (response.statusCode !== 200)
    throw new Error(`Wahoo token request failed (${response.statusCode})`)
  const parsed = TokenSchema.safeParse(JSON.parse(response.body))
  if (!parsed.success) throw new Error('Invalid Wahoo token response')
  return parsed.data
}

export const exchangeWahooCode = async ({
  code,
  redirectUri,
  clientId,
  clientSecret
}: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}) => {
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code'
  })
  return tokenRequest(body)
}

const refreshWahooToken = (settings: FitnessSettings) => {
  if (!settings.clientId || !settings.clientSecret || !settings.refreshToken) {
    throw new Error('Wahoo connection must be authorized again')
  }
  return tokenRequest(
    new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      refresh_token: settings.refreshToken,
      grant_type: 'refresh_token'
    })
  )
}

const requestWithToken = async (accessToken: string, path: string) => {
  const response = await safeRemoteFetch({
    url: `${API_BASE}${path}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    },
    maxBodyBytes: 2 * 1024 * 1024,
    timeoutInMilliseconds: 15_000
  })
  if (response.statusCode === 429) {
    const reset = getHeaderValue(response.headers, 'x-ratelimit-reset')
    const seconds = Number(reset)
    throw new WahooRateLimitError(
      Number.isFinite(seconds) && seconds > 0
        ? Math.min(86_400, Math.ceil(seconds))
        : 300
    )
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    throw new Error('Wahoo connection must be authorized again')
  }
  if (response.statusCode !== 200)
    throw new Error(`Wahoo API request failed (${response.statusCode})`)
  return JSON.parse(response.body) as unknown
}

export const requestWahoo = async (
  database: Database,
  settings: FitnessSettings,
  path: string
): Promise<unknown> => {
  if (!path.startsWith('/v1/')) throw new Error('Invalid Wahoo API path')
  if (!settings.accessToken) throw new Error('Wahoo is not connected')

  // Wahoo rotates refresh tokens and invalidates the old pair after the first
  // successful API request. Keep refresh and that request under one DB lock.
  if (
    settings.tokenExpiresAt &&
    settings.tokenExpiresAt > Date.now() + 30_000
  ) {
    return requestWithToken(settings.accessToken, path)
  }

  return withImportLock(
    database,
    `wahoo-refresh:${settings.id}`,
    async () => {
      const latest = await database.getFitnessSettings({
        actorId: settings.actorId,
        serviceType: 'wahoo'
      })
      if (!latest || latest.id !== settings.id || !latest.accessToken) {
        throw new Error('Wahoo connection was removed')
      }
      if (
        latest.tokenExpiresAt &&
        latest.tokenExpiresAt > Date.now() + 30_000
      ) {
        return requestWithToken(latest.accessToken, path)
      }

      const token = await refreshWahooToken(latest)
      const stored = await database.updateFitnessSettings({
        id: latest.id,
        expectedCredentialVersion: latest.credentialVersion ?? 0,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: Date.now() + token.expires_in * 1000,
        grantedScopes: token.scope ?? latest.grantedScopes ?? null,
        connectionError: null
      })
      if (!stored) throw new Error('Wahoo connection changed during refresh')
      return requestWithToken(token.access_token, path)
    },
    { failOnTimeout: true, ttlMs: 60_000 }
  )
}

const parseWahoo = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  name: string
): T => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(`Invalid Wahoo ${name} response`)
  return parsed.data
}

export const getWahooUser = async (
  database: Database,
  settings: FitnessSettings
) =>
  parseWahoo(
    WahooUserSchema,
    await requestWahoo(database, settings, '/v1/user'),
    'user'
  )

export const getWahooWorkout = async (
  database: Database,
  settings: FitnessSettings,
  workoutId: string
) =>
  parseWahoo(
    WahooWorkoutSchema,
    await requestWahoo(
      database,
      settings,
      `/v1/workouts/${encodeURIComponent(workoutId)}`
    ),
    'workout'
  )

export const getWahooWorkoutSummary = async (
  database: Database,
  settings: FitnessSettings,
  workoutId: string
) =>
  parseWahoo(
    WahooSummarySchema,
    await requestWahoo(
      database,
      settings,
      `/v1/workouts/${encodeURIComponent(workoutId)}/workout_summary`
    ),
    'workout summary'
  )

export const getWahooWorkoutsPage = async (
  database: Database,
  settings: FitnessSettings,
  page: number
) =>
  parseWahoo(
    WorkoutsPageSchema,
    await requestWahoo(
      database,
      settings,
      `/v1/workouts?page=${page}&per_page=50`
    ),
    'workouts'
  )
