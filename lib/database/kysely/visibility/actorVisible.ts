import { type OperandExpression, sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { StatusType } from '@/lib/types/domain/status'

// Who is looking at an actor's statuses (or the attachments, gallery media and
// fitness files hanging off them). All absent means no filter: the owner's
// own view and the full-history export. Request paths resolve it with
// `resolveActorStatusesAudience` (lib/services/statusAccess.ts).
export type ActorVisibleStatusAudience = {
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
}

// A subquery of status ids, for `where(<status id column>, 'in', …)`.
export type StatusIdsSubquery = OperandExpression<string | null>

// The status an Announce boosts: `originalStatusId`, or `content` on rows
// written before that column existed. Anything that is not an Announce points
// nowhere. The Kysely twin of announceOriginalPointer
// (lib/database/sql/utils/publiclyReadableStatus.ts), which explains why the
// two pointers collapse into one COALESCE; the Announce literal is inlined
// the same way, so the statement matches the Knex one.
const announceOriginalPointer = (
  table: 'target_statuses' | 'original_statuses'
) =>
  sql<
    string | null
  >`case when ${sql.ref(`${table}.type`)} = ${sql.lit(StatusType.enum.Announce)} then coalesce(${sql.ref(`${table}.originalStatusId`)}, ${sql.ref(`${table}.content`)}) end`

const publicRecipientStatusIds = (db: Db) =>
  db
    .selectFrom('recipients')
    .select('recipients.statusId')
    .where('recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)

// The ids among `actorId`'s statuses that anyone may read: addressed to the
// public collection, and for an Announce, every status down its boost chain
// addressed there too, ending at a non-Announce. `UNION` (not `UNION ALL`) is
// what ends a chain that loops back on itself. The Kysely twin of
// buildPubliclyReadableStatusIdsQuery (lib/database/sql/status.ts) with the
// actor's statuses as its target set: the same materialised set, which suits a
// caller with no ordered bound to stop early on.
const publiclyReadableStatusIdsOf = (db: Db, actorId: string) =>
  db
    .withRecursive(
      'publicly_readable_statuses(targetId, id, type, originalPointer)',
      (qc) =>
        qc
          .selectFrom(
            qc
              .selectFrom('statuses')
              .select('statuses.id')
              .where('statuses.actorId', '=', actorId)
              .as('target_status_ids')
          )
          .innerJoin(
            'statuses as target_statuses',
            'target_statuses.id',
            'target_status_ids.id'
          )
          .select([
            'target_statuses.id as targetId',
            'target_statuses.id',
            'target_statuses.type',
            announceOriginalPointer('target_statuses').as('originalPointer')
          ])
          .where('target_statuses.id', 'in', publicRecipientStatusIds(db))
          .union((eb) =>
            eb
              .selectFrom('statuses as original_statuses')
              .innerJoin(
                'publicly_readable_statuses as readable_statuses',
                'readable_statuses.originalPointer',
                'original_statuses.id'
              )
              .select([
                'readable_statuses.targetId',
                'original_statuses.id',
                'original_statuses.type',
                announceOriginalPointer('original_statuses').as(
                  'originalPointer'
                )
              ])
              .where('readable_statuses.type', '=', StatusType.enum.Announce)
              .where('original_statuses.id', 'in', publicRecipientStatusIds(db))
          )
    )
    .selectFrom('publicly_readable_statuses')
    .select('publicly_readable_statuses.targetId as id')
    .where('publicly_readable_statuses.type', '<>', StatusType.enum.Announce)

/**
 * The ids of `actorId`'s statuses the audience may be shown, as a subquery to
 * filter a status id column against, or `null` for no filter (all audience
 * flags absent: the owner's own view).
 *
 * - `publicOnly`: the publicly readable statuses, Announces included only
 *   when their whole boost chain is public.
 * - otherwise: every status addressed to the public collection, to the viewer
 *   (`visibleToActorId`), or with `includeFollowersOnly` to the actor's
 *   followers collection (`followersAudience` and `<actorId>/followers`). This
 *   set is not limited to the actor's statuses; the caller scopes its own rows
 *   to the actor.
 *
 * The Kysely twin of buildActorVisibleStatusIdsQuery (lib/database/sql/status.ts),
 * which still serves the gallery and status mixins;
 * actorVisibleEquivalence.test.ts runs both over the same rows. Change both
 * together.
 */
export const actorVisibleStatusIds = (
  db: Db,
  actorId: string,
  {
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience
  }: ActorVisibleStatusAudience
): StatusIdsSubquery | null => {
  if (!publicOnly && !visibleToActorId && !includeFollowersOnly) return null

  if (publicOnly) return publiclyReadableStatusIdsOf(db, actorId)

  const recipientActorIds: string[] = [...PUBLIC_ACTIVITY_RECIPIENTS]
  if (includeFollowersOnly) {
    recipientActorIds.push(
      ...[followersAudience, `${actorId}/followers`].filter(
        (audience): audience is string => Boolean(audience)
      )
    )
  }
  if (visibleToActorId) recipientActorIds.push(visibleToActorId)

  return db
    .selectFrom('recipients')
    .select('recipients.statusId')
    .where('recipients.actorId', 'in', [...new Set(recipientActorIds)])
}
