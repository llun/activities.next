import { type Expression, type SqlBool, expressionBuilder, sql } from 'kysely'

import type { DB } from '@/lib/database/kysely'

// The one rule for "this reply's parent is the same actor's own status". A
// status's `reply` names its parent either by id or by url (with `replyHash`
// the hash of that url, matched against the parent's `urlHash` index), so the
// rule is two match forms and a parent qualifies when either holds:
//
// - `exclude_replies` on `getActorStatuses` keeps a reply whose parent is the
//   actor's own (Mastodon's rule: a self-reply is not a reply), one EXISTS per
//   form.
// - `getRepliesTabStatusIds` walks the actor's self-reply chain up to its first
//   post, joining each step's parent on either form.
//
// `parent` and `child` are `statuses` aliases in the caller's query.
export const sameActorReplyParentMatches = ({
  parent,
  child,
  actorId
}: {
  parent: string
  child: string
  actorId: string
}): [byId: Expression<SqlBool>, byUrl: Expression<SqlBool>] => {
  const eb = expressionBuilder<DB, never>()
  const column = (
    alias: string,
    name: 'actorId' | 'id' | 'url' | 'urlHash' | 'reply' | 'replyHash'
  ) => sql.ref<string | null>(`${alias}.${name}`)
  const byActor = eb(column(parent, 'actorId'), '=', actorId)
  return [
    eb.and([byActor, eb(column(parent, 'id'), '=', column(child, 'reply'))]),
    eb.and([
      byActor,
      eb(column(parent, 'urlHash'), '=', column(child, 'replyHash')),
      eb(column(parent, 'url'), '=', column(child, 'reply'))
    ])
  ]
}
