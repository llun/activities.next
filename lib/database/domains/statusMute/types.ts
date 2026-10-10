// Parameter and result types of the status (conversation) mute domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// `statusId` is the thread-root status id that identifies the muted
// conversation (see resolveConversationRootId).
export type CreateStatusMuteParams = { actorId: string; statusId: string }
export type DeleteStatusMuteParams = { actorId: string; statusId: string }
export type IsConversationMutedParams = { actorId: string; statusId: string }
export type GetActorMutedConversationRootIdsParams = { actorId: string }

export interface StatusMuteDatabase {
  createStatusMute(params: CreateStatusMuteParams): Promise<void>
  deleteStatusMute(params: DeleteStatusMuteParams): Promise<void>
  isConversationMuted(params: IsConversationMutedParams): Promise<boolean>
  getActorMutedConversationRootIds(
    params: GetActorMutedConversationRootIdsParams
  ): Promise<string[]>
}
