import { TimelineFormat } from '@/lib/services/timelines/const'
import type { DirectConversation } from '@/lib/types/database/operations'
import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

export type DirectConversationView = DirectConversation & {
  accounts: MastodonAccount[]
}

export interface GetConversationsParams {
  limit?: number
  maxId?: string
  minId?: string
}

export interface GetConversationsResult {
  conversations: DirectConversationView[]
}

export const getConversations = async ({
  limit,
  maxId,
  minId
}: GetConversationsParams = {}): Promise<GetConversationsResult> => {
  const url = new URL(`${window.origin}/api/v1/conversations`)
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (limit !== undefined) url.searchParams.set('limit', `${limit}`)
  if (maxId) url.searchParams.set('max_id', maxId)
  if (minId) url.searchParams.set('min_id', minId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) return { conversations: [] }

  const data = (await response.json()) as Partial<GetConversationsResult>
  return { conversations: data.conversations ?? [] }
}

export interface GetConversationStatusesParams {
  conversationId: string
  maxStatusId?: string
  minStatusId?: string
  limit?: number
}

export interface GetConversationStatusesResult {
  statuses: Status[]
  nextMaxStatusId: string | null
}

export const getConversationStatuses = async ({
  conversationId,
  maxStatusId,
  minStatusId,
  limit
}: GetConversationStatusesParams): Promise<GetConversationStatusesResult> => {
  const url = new URL(
    `${window.origin}/api/v1/conversations/${conversationId}/statuses`
  )
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    return { statuses: [], nextMaxStatusId: null }
  }

  const data = (await response.json()) as Partial<GetConversationStatusesResult>
  return {
    statuses: data.statuses ?? [],
    nextMaxStatusId: data.nextMaxStatusId ?? null
  }
}

export interface MarkConversationReadParams {
  conversationId: string
}

export const markConversationRead = async ({
  conversationId
}: MarkConversationReadParams): Promise<boolean> => {
  const response = await fetch(`/api/v1/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { Accept: 'application/json' }
  })
  return response.ok
}

export interface HideConversationParams {
  conversationId: string
}

export const hideConversation = async ({
  conversationId
}: HideConversationParams): Promise<boolean> => {
  const response = await fetch(`/api/v1/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  return response.ok
}
