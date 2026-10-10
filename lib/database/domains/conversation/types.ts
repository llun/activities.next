// Parameter and result types of the direct conversation domain (Mastodon's
// /api/v1/conversations). lib/types/database/operations.ts re-exports them, so
// existing imports keep working.
import type { Status } from '@/lib/types/domain/status'

export type DirectConversation = {
  id: string
  actorId: string
  conversationId: string
  rootStatusId: string
  participantActorIds: string[]
  lastStatusId: string
  lastStatus: Status
  lastStatusCreatedAt: number
  unread: boolean
  readAt: number | null
  hiddenAt: number | null
  createdAt: number
  updatedAt: number
}

export type SyncDirectConversationForStatusParams = {
  status: Status
  excludedLocalActorIds?: string[]
}

export type GetDirectConversationsParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
}

export type GetDirectConversationParams = {
  actorId: string
  conversationId: string
  includeHidden?: boolean
}

export type MarkDirectConversationReadParams = {
  actorId: string
  conversationId: string
}

export type HideDirectConversationParams = {
  actorId: string
  conversationId: string
}

export type GetDirectConversationStatusesParams = {
  actorId: string
  conversationId: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}

export interface DirectConversationDatabase {
  syncDirectConversationForStatus(
    params: SyncDirectConversationForStatusParams
  ): Promise<void>
  getDirectConversations(
    params: GetDirectConversationsParams
  ): Promise<DirectConversation[]>
  getDirectConversation(
    params: GetDirectConversationParams
  ): Promise<DirectConversation | null>
  markDirectConversationRead(
    params: MarkDirectConversationReadParams
  ): Promise<DirectConversation | null>
  hideDirectConversation(params: HideDirectConversationParams): Promise<void>
  getDirectConversationStatuses(
    params: GetDirectConversationStatusesParams
  ): Promise<Status[]>
}
