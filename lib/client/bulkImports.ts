import type { ExportFileName } from '@/lib/services/exports/accountExports'
import type { SerializedBulkImport } from '@/lib/services/imports/serializeBulkImport'
import type { BulkImportType } from '@/lib/services/imports/types'

import { throwApiError } from './http'

export type { BulkImportType } from '@/lib/services/imports/types'
export type { SerializedBulkImport } from '@/lib/services/imports/serializeBulkImport'

export type BulkImportMode = 'merge' | 'overwrite'
export type BulkImportResponse = SerializedBulkImport

/** Actor-scoped URL for one of the CSV files served by `/api/v1/exports`. */
export const csvExportUrl = (file: ExportFileName, actorId: string): string => {
  const query = new URLSearchParams({ actorId })
  return `/api/v1/exports/${encodeURIComponent(file)}?${query.toString()}`
}

export interface CreateBulkImportParams {
  actorId: string
  file: File
  type: BulkImportType
  mode: BulkImportMode
}

export interface GetBulkImportParams {
  actorId: string
  id: string
}

const BULK_IMPORTS_URL = '/api/v1/imports'

/** Create a background import from a Mastodon-compatible CSV file. */
export const createBulkImport = async ({
  actorId,
  file,
  type,
  mode
}: CreateBulkImportParams): Promise<BulkImportResponse> => {
  const form = new FormData()
  form.append('actorId', actorId)
  form.append('type', type)
  form.append('mode', mode)
  form.append('file', file, file.name)

  const response = await fetch(BULK_IMPORTS_URL, {
    method: 'POST',
    body: form
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not start the import')
  }
  return response.json()
}

/** Read the progress and failed rows for one actor-scoped CSV import. */
export const getBulkImport = async ({
  actorId,
  id
}: GetBulkImportParams): Promise<BulkImportResponse> => {
  const query = new URLSearchParams({ actorId })
  const response = await fetch(
    `${BULK_IMPORTS_URL}/${encodeURIComponent(id)}?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not load the import')
  }
  return response.json()
}
