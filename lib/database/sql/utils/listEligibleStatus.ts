import { Knex } from 'knex'

import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  statusActorFollowersUrlExpression
} from '@/lib/database/sql/utils/statusVisibility'
import { StatusType } from '@/lib/types/domain/status'

const AUTHORS_ALIAS = 'list_eligible_authors'

// Keep direct messages out of a list feed, as Mastodon does: its fan-out only
// delivers public, unlisted and followers-only statuses to lists
// (FanOutOnWriteService#deliver_to_lists!), and the merge that backfills a new
// member reads `list_eligible_visibility`. Without this, the list owner's own
// DMs (once they add themselves) and a member's DM addressed to the owner both
// surfaced in the list, although neither ever appears in Home — Home routes a
// DM to the Direct feed instead.
//
// A boost is never direct. Any other status is list-eligible when one of its
// `to`/`cc` recipients is the public collection or a followers collection;
// otherwise it is addressed to specific people only, and a status with no
// recipient rows is not eligible either. That is isDirectStatus
// (lib/utils/directStatus.ts), which routing uses, with one widening: besides
// getVisibility's `/followers` suffix, the author's STORED followers URL counts
// too — the same pair applyPotentiallyReadableStatusFilter matches — because not
// every server names the collection that way (Friendica's is `/followers/<nick>`)
// and those followers-only posts showed in lists before this filter existed.
// LIKE folds ASCII case on SQLite (not on PostgreSQL), so there an upper-case
// `/FOLLOWERS` suffix also counts.
//
// Pure WHERE/EXISTS on `statuses`, so it composes with the list timeline's
// other filters and runs before LIMIT; the recipients lookup is served by
// recipients_status_type_actor_idx (statusId leading) and the author by the
// actors primary key.
export const applyListEligibleStatusFilter = ({
  database,
  query
}: {
  database: Knex
  query: Knex.QueryBuilder
}) =>
  query.where((builder) => {
    builder
      .where('statuses.type', StatusType.enum.Announce)
      .orWhereExists(function () {
        this.select(database.raw('1'))
          .from('recipients as list_eligible_recipients')
          .leftJoin(
            `actors as ${AUTHORS_ALIAS}`,
            `${AUTHORS_ALIAS}.id`,
            'statuses.actorId'
          )
          .whereRaw('?? = ??', [
            'list_eligible_recipients.statusId',
            'statuses.id'
          ])
          .where((audience) => {
            audience
              .whereIn(
                'list_eligible_recipients.actorId',
                PUBLIC_ACTIVITY_RECIPIENTS
              )
              .orWhere(
                'list_eligible_recipients.actorId',
                'like',
                '%/followers'
              )
              .orWhereRaw(
                `?? = ${statusActorFollowersUrlExpression(database, AUTHORS_ALIAS)}`,
                ['list_eligible_recipients.actorId']
              )
          })
      })
  })
