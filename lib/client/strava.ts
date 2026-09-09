import { MastodonVisibility } from '@/lib/utils/getVisibility'

import { throwApiError } from './http'

export interface StravaSettingsResponse {
  configured: boolean
  actorId?: string
  actorHandle?: string
  clientId?: string
  connected?: boolean
  webhookUrl?: string
  defaultVisibility: MastodonVisibility
}

export type StravaSettings = StravaSettingsResponse

export interface GetStravaSettingsParams {
  signal?: AbortSignal
}

export const getStravaSettings = async (
  params?: GetStravaSettingsParams | AbortSignal
): Promise<StravaSettingsResponse> => {
  const signal = params instanceof AbortSignal ? params : params?.signal
  const response = await fetch('/api/v1/fitness/strava', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to load settings')
  }

  return response.json()
}

export interface SaveStravaSettingsParams {
  clientId?: string
  clientSecret?: string
  defaultVisibility?: MastodonVisibility
  signal?: AbortSignal
}

export interface SaveStravaSettingsResponse {
  success: boolean
  message: string
  authorizeUrl?: string
}

export const saveStravaSettings = async ({
  clientId,
  clientSecret,
  defaultVisibility,
  signal
}: SaveStravaSettingsParams): Promise<SaveStravaSettingsResponse> => {
  const body: {
    clientId?: string
    clientSecret?: string
    defaultVisibility?: MastodonVisibility
  } = {}
  if (clientId !== undefined) body.clientId = clientId
  if (clientSecret !== undefined) body.clientSecret = clientSecret
  if (defaultVisibility !== undefined)
    body.defaultVisibility = defaultVisibility

  const response = await fetch('/api/v1/fitness/strava', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to save settings')
  }

  return response.json()
}

export interface DeleteStravaSettingsParams {
  signal?: AbortSignal
}

export interface DeleteStravaSettingsResponse {
  success: boolean
  message: string
}

export const deleteStravaSettings = async (
  params?: DeleteStravaSettingsParams | AbortSignal
): Promise<DeleteStravaSettingsResponse> => {
  const signal = params instanceof AbortSignal ? params : params?.signal
  const response = await fetch('/api/v1/fitness/strava', {
    method: 'DELETE',
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to remove settings')
  }

  return response.json()
}
