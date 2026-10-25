export interface ActorHandle {
  id: string
  actorId: string
  username: string
  // Stored lowercase; folded again on read so a legacy mixed-case domain
  // compares equal to its lowercase spelling.
  domain: string
  createdAt: number
  // Null while this row is the actor's current handle; set when the handle
  // was given up (a rename away, or the actor's deletion).
  replacedAt: number | null
}

export interface ActorHandleName {
  username: string
  domain: string
}

export interface GetActorHandlesParams {
  actorId: string
}

export interface GetCurrentActorHandleParams {
  actorId: string
}

export interface GetLatestActorHandleReplacedAtParams {
  actorId: string
}

export interface RecordActorHandleRenameParams {
  actorId: string
  username: string
  domain: string
  now: Date
  // A rename inside this window after the actor's latest replacement is
  // refused with 'cooldown'.
  cooldownMs: number
}

export type RecordActorHandleRenameResult =
  | {
      ok: true
      previous: ActorHandleName
      current: ActorHandleName
      // The id of the ledger row that just became current (the revived row on
      // a rename back, the new row otherwise).
      handleId: string
    }
  | { ok: false; status: 'not_found' }
  | { ok: false; status: 'moved' }
  | { ok: false; status: 'unavailable' }
  | { ok: false; status: 'cannot_rename' }
  | { ok: false; status: 'unchanged' }
  | { ok: false; status: 'cooldown'; cooldownUntil: number }
  | { ok: false; status: 'taken' }

export interface ActorHandleDatabase {
  // Every ledger row of the actor, the current handle first, then the
  // replaced ones newest first.
  getActorHandles(params: GetActorHandlesParams): Promise<ActorHandle[]>
  // The row whose handle the actor holds now, or null when the actor has no
  // ledger row (never renamed, or minted before the ledger existed).
  getCurrentActorHandle(
    params: GetCurrentActorHandleParams
  ): Promise<ActorHandle | null>
  // When the actor last gave a handle up, or null while it never has. The
  // rename cooldown reads this.
  getLatestActorHandleReplacedAt(
    params: GetLatestActorHandleReplacedAtParams
  ): Promise<number | null>
  // One transaction under a lock on the actor row: validates the target
  // handle, revives or creates the row that becomes current, retires the old
  // one and updates the actor. Refusals come back as the union's `ok: false`
  // members, never as throws.
  recordActorHandleRename(
    params: RecordActorHandleRenameParams
  ): Promise<RecordActorHandleRenameResult>
}
