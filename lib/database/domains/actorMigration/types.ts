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
  // Newest first.
  getActorMigrations(
    params: GetActorMigrationsParams
  ): Promise<ActorMigration[]>
  // The newest 'move' (a redirect never counts toward the cooldown).
  getLastActorMove(
    params: GetLastActorMoveParams
  ): Promise<ActorMigration | null>
}
