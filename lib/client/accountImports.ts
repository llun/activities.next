import type { AccountImportProgress } from '@/lib/services/accountImport/progress'
import type {
  AccountImportOutcomeReport,
  AccountImportStatus
} from '@/lib/types/domain/accountImport'

import { ApiRequestError, parseRetryAfterMs, throwApiError } from './http'

export interface AccountImportResponse {
  id: string
  status: AccountImportStatus
  kind: string | null
  phase: string | null
  progress: AccountImportProgress
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  lastErrorCode: string | null
  report?: AccountImportOutcomeReport
}

export interface PresignedAccountImportResponse extends AccountImportResponse {
  uploadUrl: string | null
  directUploadPath: string | null
}

export interface AccountImportOptions {
  likes: boolean
  bookmarks: boolean
  repliesToOthers: 'skip' | 'keep'
  profile: boolean
  settings: boolean
}

export interface CreatePresignedImportParams {
  actorId: string
  size: number
}

export interface UploadAccountImportProgress {
  loaded: number
  total: number
}

export interface UploadAccountImportParams {
  actorId: string
  file: File
  uploadUrl: string | null
  directUploadPath: string | null
  onProgress?: (progress: UploadAccountImportProgress) => void
  signal?: AbortSignal
}

export interface StartAccountImportParams {
  actorId: string
  importId: string
  options: AccountImportOptions
}

export interface GetAccountImportParams {
  actorId: string
  id: string
}

const IMPORTS_URL = '/api/v1/account/imports'

const parseXhrDetails = (
  responseText: string
): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(responseText)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export const createPresignedImport = async ({
  actorId,
  size
}: CreatePresignedImportParams): Promise<PresignedAccountImportResponse> => {
  const response = await fetch(`${IMPORTS_URL}/presigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, size })
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not prepare the archive upload')
  }
  return response.json()
}

/** Upload the selected ZIP without reading it into memory or using fetch. */
export const uploadAccountImport = ({
  actorId,
  file,
  uploadUrl,
  directUploadPath,
  onProgress,
  signal
}: UploadAccountImportParams): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!uploadUrl && !directUploadPath) {
      reject(new ApiRequestError('No archive upload path was returned', 503))
      return
    }

    const xhr = new XMLHttpRequest()
    const direct = !uploadUrl
    const url = directUploadPath
      ? `${directUploadPath}${directUploadPath.includes('?') ? '&' : '?'}actorId=${encodeURIComponent(actorId)}`
      : uploadUrl!
    xhr.open(direct ? 'POST' : 'PUT', url)
    xhr.withCredentials = direct
    // The streamed route receives a raw archive body. Presigned S3 PUTs sign
    // ContentLength only, so they must carry no application-added headers.
    if (direct) xhr.setRequestHeader('Content-Type', 'application/zip')

    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : file.size
      })
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      const details = parseXhrDetails(xhr.responseText)
      const message =
        typeof details?.error === 'string'
          ? details.error
          : 'The archive upload did not finish'
      reject(
        new ApiRequestError(
          message,
          xhr.status,
          parseRetryAfterMs(xhr.getResponseHeader('Retry-After')),
          details
        )
      )
    })
    xhr.addEventListener('error', () => {
      reject(new ApiRequestError('The archive upload did not finish', 0))
    })
    xhr.addEventListener('abort', () => {
      reject(new ApiRequestError('The archive upload was cancelled', 0))
    })
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(file)
  })

export const startAccountImport = async ({
  actorId,
  importId,
  options
}: StartAccountImportParams): Promise<AccountImportResponse> => {
  const response = await fetch(
    `${IMPORTS_URL}/${encodeURIComponent(importId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId, options })
    }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not start the import')
  }
  return response.json()
}

export const listAccountImports = async ({
  actorId
}: Pick<GetAccountImportParams, 'actorId'>): Promise<
  AccountImportResponse[]
> => {
  const query = new URLSearchParams({ actorId })
  const response = await fetch(`${IMPORTS_URL}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not load your imports')
  }
  return response.json()
}

export const getAccountImport = async ({
  actorId,
  id
}: GetAccountImportParams): Promise<AccountImportResponse> => {
  const query = new URLSearchParams({ actorId })
  const response = await fetch(
    `${IMPORTS_URL}/${encodeURIComponent(id)}?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not load the import')
  }
  return response.json()
}

export const cancelAccountImport = async ({
  actorId,
  id
}: GetAccountImportParams): Promise<AccountImportResponse> => {
  const query = new URLSearchParams({ actorId })
  const response = await fetch(
    `${IMPORTS_URL}/${encodeURIComponent(id)}?${query.toString()}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not cancel the import')
  }
  return response.json()
}
