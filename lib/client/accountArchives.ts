import type { AccountArchiveStatus } from '@/lib/types/domain/accountArchive'

import { throwApiError } from './http'

export interface AccountArchiveResponse {
  id: string
  status: AccountArchiveStatus
  stripExactLocations: boolean
  includesDrafts: boolean
  bytes: number | null
  createdAt: string
  readyAt: string | null
  expiresAt: string | null
  error: string | null
  downloadUrl: string | null
}

export interface ListAccountArchivesParams {
  actorId: string
}

export interface RequestAccountArchiveParams {
  actorId: string
  stripExactLocations?: boolean
  drafts?: unknown
}

const ARCHIVES_URL = '/api/v1/account/archives'

export const listAccountArchives = async ({
  actorId
}: ListAccountArchivesParams): Promise<AccountArchiveResponse[]> => {
  const query = new URLSearchParams({ actorId })
  const response = await fetch(`${ARCHIVES_URL}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not load your archives')
  }
  return response.json()
}

export const requestAccountArchive = async ({
  actorId,
  stripExactLocations,
  drafts
}: RequestAccountArchiveParams): Promise<AccountArchiveResponse> => {
  const body: {
    actorId: string
    stripExactLocations?: boolean
    drafts?: unknown
  } = { actorId }
  if (stripExactLocations !== undefined) {
    body.stripExactLocations = stripExactLocations
  }
  if (drafts !== undefined) body.drafts = drafts

  const response = await fetch(ARCHIVES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not prepare your archive')
  }
  return response.json()
}
