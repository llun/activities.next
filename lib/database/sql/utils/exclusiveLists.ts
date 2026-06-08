import { Knex } from 'knex'

// Hide statuses authored by members of the viewer's *exclusive* lists from the
// home feed. https://docs.joinmastodon.org/entities/List/#exclusive
//
// Applied at read time (a NOT EXISTS over the viewer's exclusive lists) rather
// than at fan-out, so toggling `exclusive` or changing list membership takes
// effect immediately for posts already sitting in the timelines table — no
// stale rows a later toggle could not retract. Scoped to the viewer's own
// lists, so another owner's exclusive list never affects this viewer.
export const applyExclusiveListFilter = ({
  database,
  query,
  viewerActorId
}: {
  database: Knex
  query: Knex.QueryBuilder
  viewerActorId: string
}) => {
  query.whereNotExists(function () {
    this.select(database.raw('1'))
      .from('list_accounts as exclusive_list_accounts')
      .innerJoin(
        'lists as exclusive_lists',
        'exclusive_lists.id',
        'exclusive_list_accounts.listId'
      )
      .where('exclusive_lists.actorId', viewerActorId)
      .where('exclusive_lists.exclusive', true)
      .whereRaw('?? = ??', [
        'exclusive_list_accounts.targetActorId',
        'timelines.statusActorId'
      ])
  })
}
