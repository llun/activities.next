import bcrypt from 'bcrypt'
import crypto from 'crypto'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import type { ActorMigrationKind } from '@/lib/database/domains/actorMigration/types'
import type { Database } from '@/lib/database/types'
import { SEND_MOVE_JOB_NAME } from '@/lib/jobs/names'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { actorIdsMatch } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Mastodon: AccountMigration::COOLDOWN_PERIOD.
export const MOVE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export interface MigrationState {
  movedTo: { id: string; acct: string | null } | null
  migrations: {
    targetActorId: string
    acct: string
    kind: ActorMigrationKind
    createdAt: string
  }[]
  cooldownUntil: string | null
  followersCount: number
}

export type OutgoingMoveFailure = {
  ok: false
  status: 403 | 404 | 422 | 429 | 503
  error: string
  cooldownUntil?: string
}

export const getMigrationState = async (
  database: Database,
  actor: Pick<Actor, 'id' | 'movedTo'>
): Promise<MigrationState> => {
  const [migrations, lastMove, followersCount, movedToActor] =
    await Promise.all([
      database.getActorMigrations({ actorId: actor.id }),
      database.getLastActorMove({ actorId: actor.id }),
      database.getActorFollowersCount({ actorId: actor.id }),
      actor.movedTo ? database.getActorFromId({ id: actor.movedTo }) : null
    ])
  const cooldownEnd = lastMove ? lastMove.createdAt + MOVE_COOLDOWN_MS : 0
  return {
    movedTo: actor.movedTo
      ? {
          id: actor.movedTo,
          acct: movedToActor
            ? `${movedToActor.username}@${movedToActor.domain}`
            : null
        }
      : null,
    migrations: migrations.map((migration) => ({
      targetActorId: migration.targetActorId,
      acct: migration.targetAcct,
      kind: migration.kind,
      createdAt: new Date(migration.createdAt).toISOString()
    })),
    cooldownUntil:
      cooldownEnd > Date.now() ? new Date(cooldownEnd).toISOString() : null,
    followersCount
  }
}

// Mastodon's save_with_challenge: the password when the account has one, the
// current username otherwise. No other settings route has a passwordless
// confirmation to reuse.
export const verifyChallenge = async ({
  actor,
  password,
  username
}: {
  actor: Pick<Actor, 'username' | 'account'>
  password?: string
  username?: string
}): Promise<string | null> => {
  const passwordHash = actor.account?.passwordHash
  if (passwordHash) {
    if (!password || !(await bcrypt.compare(password, passwordHash))) {
      return 'Invalid password'
    }
    return null
  }
  if (username?.toLowerCase() !== actor.username.toLowerCase()) {
    return 'Invalid username'
  }
  return null
}

const fail = (
  status: OutgoingMoveFailure['status'],
  error: string,
  cooldownUntil?: string
): OutgoingMoveFailure => ({ ok: false, status, error, cooldownUntil })

const ALIAS_REQUIRED = 'Add this account as an alias on the new account first'

// The alias list is read from the target's own origin on every request (never
// the cached row), as moveActorJob does for an inbound Move: a stale cache must
// not let a move through, or block one the user just prepared.
const readTargetFresh = async (
  database: Database,
  target: Actor
): Promise<{ aliases: string[]; moved: boolean } | null> => {
  if (target.privateKey) {
    return { aliases: target.alsoKnownAs ?? [], moved: Boolean(target.movedTo) }
  }
  const signingActor = await getFederationSigningActorSafe(
    database,
    'for outgoing move'
  )
  const person = await getActorPerson({ actorId: target.id, signingActor })
  if (!person || !actorIdsMatch(person.id, target.id)) return null
  return { aliases: person.alsoKnownAs ?? [], moved: Boolean(person.movedTo) }
}

export const performOutgoingMove = async ({
  database,
  actor,
  target,
  kind
}: {
  database: Database
  actor: Actor
  target: Actor
  kind: ActorMigrationKind
}): Promise<{ ok: true } | OutgoingMoveFailure> => {
  if (actorIdsMatch(target.id, actor.id)) {
    return fail(422, 'Cannot move to yourself')
  }
  const states = await database.getModerationStatesForActors({
    actorIds: [target.id]
  })
  if (states.get(target.id)?.suspendedAt || target.deletionStatus) {
    return fail(422, 'Target account is not available')
  }
  if (target.movedTo) return fail(422, 'Target account has moved')
  if (actor.movedTo && actorIdsMatch(actor.movedTo, target.id)) {
    return fail(422, 'Already moved to this account')
  }

  if (kind === 'move') {
    const fresh = await readTargetFresh(database, target)
    if (fresh?.moved) return fail(422, 'Target account has moved')
    if (!fresh?.aliases.some((alias) => actorIdsMatch(alias, actor.id))) {
      return fail(422, ALIAS_REQUIRED)
    }
    const lastMove = await database.getLastActorMove({ actorId: actor.id })
    const cooldownEnd = lastMove ? lastMove.createdAt + MOVE_COOLDOWN_MS : 0
    if (cooldownEnd > Date.now()) {
      const cooldownUntil = new Date(cooldownEnd).toISOString()
      return fail(
        429,
        `You can move again after ${cooldownUntil}`,
        cooldownUntil
      )
    }
  }

  await database.updateActor({ actorId: actor.id, movedTo: target.id })
  const migrationId = crypto.randomUUID()
  await database.createActorMigration({
    id: migrationId,
    actorId: actor.id,
    targetActorId: target.id,
    targetAcct: `${target.username}@${target.domain}`,
    kind,
    followersCount: await database.getActorFollowersCount({
      actorId: actor.id
    })
  })
  await publishActorUpdate({ actorId: actor.id })

  if (kind === 'move') {
    try {
      await getQueue().publish({
        id: `${migrationId}:start`,
        name: SEND_MOVE_JOB_NAME,
        data: {
          migrationId,
          originActorId: actor.id,
          targetActorId: target.id
        }
      })
    } catch (error) {
      // movedTo and the migration row are already saved and the Update(Person)
      // is out, so rolling back would show remote servers a move that never
      // happened. The 503 tells the user the Move delivery did not start.
      logger.error({
        message: 'Failed to queue the Move activity',
        actorId: actor.id,
        migrationId,
        err: toLoggableError(error)
      })
      return fail(503, 'Could not start the move, try again later')
    }
  }
  return { ok: true }
}
