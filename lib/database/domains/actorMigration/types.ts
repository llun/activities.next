export type ActorMigrationKind = 'move' | 'redirect'

export interface ActorMigration {
  id: string
  actorId: string
  targetActorId: string
  targetAcct: string
  kind: ActorMigrationKind
  followersCount: number
  createdAt: number
}

export interface CreateActorMigrationParams {
  id: string
  actorId: string
  targetActorId: string
  targetAcct: string
  kind: ActorMigrationKind
  followersCount: number
}

export interface RecordActorMigrationParams extends CreateActorMigrationParams {
  // A 'move' inside this window after the last 'move' is refused.
  cooldownMs: number
}

export type RecordActorMigrationResult =
  | { status: 'created'; migration: ActorMigration }
  // An earlier call already recorded this exact move: nothing was written.
  | { status: 'existing'; migration: ActorMigration }
  | { status: 'cooldown'; until: number }
  | { status: 'no-actor' }

export interface GetActorMigrationsParams {
  actorId: string
  limit?: number
}

export interface GetLastActorMoveParams {
  actorId: string
}

export interface ActorMigrationDatabase {
  createActorMigration(
    params: CreateActorMigrationParams
  ): Promise<ActorMigration>
  // One transaction under a lock on the actor row: checks the move cooldown,
  // inserts the row and sets settings.movedTo, so concurrent or retried calls
  // record one move and a crash cannot leave movedTo without a row.
  recordActorMigration(
    params: RecordActorMigrationParams
  ): Promise<RecordActorMigrationResult>
  // Newest first.
  getActorMigrations(
    params: GetActorMigrationsParams
  ): Promise<ActorMigration[]>
  // The newest 'move' (a redirect never counts toward the cooldown).
  getLastActorMove(
    params: GetLastActorMoveParams
  ): Promise<ActorMigration | null>
}
