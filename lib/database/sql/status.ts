import { Knex } from 'knex'

import { announceOriginalPointer } from '@/lib/database/sql/utils/publiclyReadableStatus'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/sql/utils/statusVisibility'
import { StatusType } from '@/lib/types/domain/status'

// The Knex forms of the publicly-readable and actor-visible status id sets.
// The status domain itself is Kysely (lib/database/domains/status/); these two
// builders have no production caller left and stay as the references the
// equivalence tests run their Kysely twins against.

const publicRecipientStatusIds = (database: Knex) =>
  database('recipients')
    .select('statusId')
    .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)

// The Kysely twin is publiclyReadableStatusIds
// (lib/database/kysely/visibility/publiclyReadable.ts), which getRebloggedBy
// and getActorStatusesCount use. This Knex form has no production caller
// left: it stays as the reference publiclyReadableStatusEquivalence.test.ts
// runs the twin against over the same rows, and statusReadableSql.test.ts
// pins its compiled SQL, MySQL branch included.
export const buildPubliclyReadableStatusIdsQuery = ({
  database,
  targetStatusIds
}: {
  database: Knex
  targetStatusIds: Knex.QueryBuilder
}) => {
  const clientName = String(database.client.config.client)
  const targetStatusIdsQuery = targetStatusIds.clone().as('target_status_ids')

  if (clientName.includes('mysql')) {
    return database
      .select('target_statuses.id')
      .from(targetStatusIdsQuery)
      .innerJoin(
        'statuses as target_statuses',
        'target_statuses.id',
        'target_status_ids.id'
      )
      .whereIn('target_statuses.id', publicRecipientStatusIds(database))
      .where((qb) => {
        qb.whereNot(
          'target_statuses.type',
          StatusType.enum.Announce
        ).orWhereExists(function () {
          this.select(database.raw('1'))
            .from('statuses as original_statuses')
            .where(
              'original_statuses.id',
              announceOriginalPointer(database, 'target_statuses')
            )
            // One hop only: a boosted boost is rejected here rather than
            // followed, so MySQL answers "not publicly readable" where the
            // recursive branch below walks the chain and answers "yes". The
            // gap predates the shared pointer and MySQL has no CI coverage,
            // so nothing will tell you if it ever matters.
            .whereNot('original_statuses.type', StatusType.enum.Announce)
            .whereIn('original_statuses.id', publicRecipientStatusIds(database))
        })
      })
  }

  return database
    .withRecursive(
      'publicly_readable_statuses',
      ['targetId', 'id', 'type', 'originalPointer'],
      (cte) => {
        cte
          .select(
            'target_statuses.id as targetId',
            'target_statuses.id',
            'target_statuses.type',
            announceOriginalPointer(database, 'target_statuses')
          )
          .from(targetStatusIdsQuery)
          .innerJoin(
            'statuses as target_statuses',
            'target_statuses.id',
            'target_status_ids.id'
          )
          .whereIn('target_statuses.id', publicRecipientStatusIds(database))
          .union((qb) => {
            qb.select(
              'readable_statuses.targetId',
              'original_statuses.id',
              'original_statuses.type',
              announceOriginalPointer(database, 'original_statuses')
            )
              .from('statuses as original_statuses')
              .innerJoin(
                'publicly_readable_statuses as readable_statuses',
                'readable_statuses.originalPointer',
                'original_statuses.id'
              )
              .where('readable_statuses.type', StatusType.enum.Announce)
              .whereIn(
                'original_statuses.id',
                publicRecipientStatusIds(database)
              )
          })
      }
    )
    .select('targetId as id')
    .from('publicly_readable_statuses')
    .whereNot('type', StatusType.enum.Announce)
}

// The set of one actor's status ids a given audience may be shown, as a
// subquery to filter against. Its Kysely twin actorVisibleStatusIds
// (lib/database/kysely/visibility/actorVisible.ts) is what `getActorStatuses`
// filters `statuses.id` by and `getAttachmentsForActor` filters
// `attachments.statusId` by, so a followers-only post's images are withheld
// from exactly the viewers the post itself is withheld from. This Knex form
// has no production caller left; it stays as the reference
// actorVisibleEquivalence.test.ts holds the twin to, so change both together.
//
// Returns `null` for "no filter", which is a real audience rather than a
// missing one — the owner viewing their own timeline, and the complete history
// export in `scripts/backup/actorArchive.ts`. Callers must therefore decide the
// audience deliberately; `resolveActorStatusesAudience` in
// `@/lib/services/statusAccess` is how request paths do that.
export const buildActorVisibleStatusIdsQuery = ({
  database,
  actorId,
  publicOnly = false,
  visibleToActorId,
  includeFollowersOnly = false,
  followersAudience
}: {
  database: Knex
  actorId: string
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
}): Knex.QueryBuilder | null => {
  if (!publicOnly && !visibleToActorId && !includeFollowersOnly) return null

  if (publicOnly) {
    return buildPubliclyReadableStatusIdsQuery({
      database,
      targetStatusIds: database('statuses')
        .select('statuses.id')
        .where('actorId', actorId)
    })
  }

  const recipientActorIds = [...PUBLIC_ACTIVITY_RECIPIENTS]
  if (includeFollowersOnly) {
    recipientActorIds.push(
      ...[followersAudience, `${actorId}/followers`].filter(
        (audience): audience is string => Boolean(audience)
      )
    )
  }
  if (visibleToActorId) {
    recipientActorIds.push(visibleToActorId)
  }

  return database('recipients')
    .select('statusId')
    .whereIn('recipients.actorId', [...new Set(recipientActorIds)])
}
