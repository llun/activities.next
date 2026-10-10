// Parameter and result types of the accountNote domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type UpsertAccountNoteParams = {
  actorId: string
  targetActorId: string
  comment: string
}
export type GetAccountNoteParams = {
  actorId: string
  targetActorId: string
}

export interface AccountNoteDatabase {
  // Sets the private note for (actorId -> targetActorId). An empty comment
  // clears the note. Returns the stored comment (empty string when cleared).
  upsertAccountNote(params: UpsertAccountNoteParams): Promise<string>
  getAccountNote(params: GetAccountNoteParams): Promise<string>
}
