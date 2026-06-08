import { Knex } from 'knex'

import { FollowStatus } from '@/lib/types/domain/follow'
import { ListRepliesPolicy } from '@/lib/types/domain/list'

// Enforce a list's Mastodon "replies_policy" on a list-timeline query, applied
// as a pure WHERE so it composes with the existing visibility filter and runs
// BEFORE LIMIT. https://docs.joinmastodon.org/entities/List/#replies_policy
//
// Mirrors FeedManager#filter_from_list?: a status always passes when it is not
// a reply, when it is a self-reply (thread continuation), or when it replies to
// the list owner. Only the *remaining* replies are governed by the policy:
//   - 'none':     no further replies are shown.
//   - 'list':     show replies whose parent author is also a list member.
//   - 'followed': show replies whose parent author the owner follows.
// A reply whose parent is not stored locally (e.g. a reply to a remote post we
// never fetched) has no resolvable parent author, so it is treated as neither a
// member nor followed and is filtered out under every policy.
export const applyListRepliesPolicyFilter = ({
  database,
  query,
  repliesPolicy,
  listId,
  ownerId
}: {
  database: Knex
  query: Knex.QueryBuilder
  repliesPolicy: ListRepliesPolicy
  listId: string
  ownerId: string
}) => {
  // Match the parent status by its id, or by its url (with the indexed hash) so
  // replies that reference the parent's url resolve too — same dual lookup the
  // visibility filter and resolveParentStatusIdByReply use.
  const applyParentReference = (
    builder: Knex.QueryBuilder,
    referenceColumn: string,
    referenceHashColumn?: string
  ) => {
    if (referenceHashColumn) {
      builder.whereRaw('?? = ??', ['statuses.replyHash', referenceHashColumn])
    }
    builder.whereRaw('?? = ??', ['statuses.reply', referenceColumn])
  }

  // Author conditions that let a reply through given a resolved parent row.
  const applyPermittedParentAuthor = (builder: Knex.QueryBuilder) => {
    builder.where((authorQb) => {
      authorQb
        // Self-reply: parent author is the reply author (thread continuation).
        .whereRaw('?? = ??', [
          'reply_policy_parent.actorId',
          'statuses.actorId'
        ])
        // Reply addressed to the list owner.
        .orWhere('reply_policy_parent.actorId', ownerId)

      if (repliesPolicy === 'list') {
        authorQb.orWhereExists(function () {
          this.select(database.raw('1'))
            .from('list_accounts as reply_policy_members')
            .where('reply_policy_members.listId', listId)
            .where('reply_policy_members.actorId', ownerId)
            .whereRaw('?? = ??', [
              'reply_policy_members.targetActorId',
              'reply_policy_parent.actorId'
            ])
        })
      } else if (repliesPolicy === 'followed') {
        authorQb.orWhereExists(function () {
          this.select(database.raw('1'))
            .from('follows as reply_policy_follows')
            .where('reply_policy_follows.actorId', ownerId)
            .where('reply_policy_follows.status', FollowStatus.enum.Accepted)
            .whereRaw('?? = ??', [
              'reply_policy_follows.targetActorId',
              'reply_policy_parent.actorId'
            ])
        })
      }
      // 'none': only self-replies and replies to the owner pass.
    })
  }

  const applyPermittedReplyExists = (
    builder: Knex.QueryBuilder,
    referenceColumn: string,
    referenceHashColumn?: string
  ) => {
    builder.select(database.raw('1')).from('statuses as reply_policy_parent')
    applyParentReference(builder, referenceColumn, referenceHashColumn)
    applyPermittedParentAuthor(builder)
  }

  return query.where((qb) => {
    // Non-replies always pass.
    qb.where('statuses.reply', '')
      .orWhereNull('statuses.reply')
      .orWhereExists(function () {
        applyPermittedReplyExists(this, 'reply_policy_parent.id')
      })
      .orWhereExists(function () {
        applyPermittedReplyExists(
          this,
          'reply_policy_parent.url',
          'reply_policy_parent.urlHash'
        )
      })
  })
}
