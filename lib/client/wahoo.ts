import type { Visibility } from '@/lib/types/mastodon/visibility'

import { throwApiError } from './http'

export type WahooEnvironment = 'sandbox' | 'production'

export interface WahooSettingsResponse {
  configured: boolean
  actorId?: string
  actorHandle?: string
  clientId?: string
  hasClientSecret: boolean
  hasWebhookToken: boolean
  connected: boolean
  environment: WahooEnvironment
  defaultVisibility: Visibility
  webhookUrl: string
  callbackUrl: string
  automaticImportAvailable: boolean
  providerUserId?: string
  lastWebhookAt?: string
  lastImportAt?: string
  lastError?: string
}

export interface SaveWahooSettingsParams {
  clientId?: string
  clientSecret?: string
  webhookToken?: string
  environment?: WahooEnvironment
  defaultVisibility?: Visibility
}

export interface WahooHistoryImport {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  fromDate: string
  toDate: string
  total: number
  completed: number
  failed: number
  lastError?: string
}

export interface WahooHistoryResponse {
  import: WahooHistoryImport | null
}

export interface WahooFailedImport {
  id: string
  workoutId: string
  status: 'failed' | 'unsupported'
  lastError?: string | null
}

export interface WahooFailedImportsResponse {
  imports: WahooFailedImport[]
}

export const getWahooSettings = async (signal?: AbortSignal) => {
  const response = await fetch('/api/v1/fitness/wahoo', {
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to load Wahoo settings')
  return (await response.json()) as WahooSettingsResponse
}

export const saveWahooSettings = async (settings: SaveWahooSettingsParams) => {
  const response = await fetch('/api/v1/fitness/wahoo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to save Wahoo settings')
  return (await response.json()) as { success: boolean }
}

export const deleteWahooSettings = async () => {
  const response = await fetch('/api/v1/fitness/wahoo', { method: 'DELETE' })
  if (!response.ok) await throwApiError(response, 'Failed to disconnect Wahoo')
}

export const getWahooHistory = async (signal?: AbortSignal) => {
  const response = await fetch('/api/v1/fitness/wahoo/history', {
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to load import status')
  return (await response.json()) as WahooHistoryResponse
}

export const startWahooHistory = async (fromDate: string, toDate: string) => {
  const response = await fetch('/api/v1/fitness/wahoo/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromDate, toDate })
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to start history import')
}

export const cancelWahooHistory = async () => {
  const response = await fetch('/api/v1/fitness/wahoo/history', {
    method: 'DELETE'
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to cancel history import')
}

export const retryWahooHistory = async () => {
  const response = await fetch('/api/v1/fitness/wahoo/history', {
    method: 'PATCH'
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to retry history import')
}

export const getWahooFailedImports = async (signal?: AbortSignal) => {
  const response = await fetch('/api/v1/fitness/wahoo/imports', {
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to load Wahoo import errors')
  return (await response.json()) as WahooFailedImportsResponse
}

export const retryWahooFailedImport = async (importId: string) => {
  const response = await fetch('/api/v1/fitness/wahoo/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ importId })
  })
  if (!response.ok)
    await throwApiError(response, 'Failed to retry Wahoo workout')
}
