import { Knex } from 'knex'

import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

export const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

const statusActorFollowersUrlExpression = (database: Knex) => {
  const clientName = String(database.client.config.client)
  if (clientName.includes('pg')) {
    return "status_actors.settings::jsonb ->> 'followersUrl'"
  }
  if (clientName.includes('mysql')) {
    return "JSON_UNQUOTE(JSON_EXTRACT(status_actors.settings, '$.followersUrl'))"
  }
  return "json_extract(status_actors.settings, '$.followersUrl')"
}

export const applyPotentiallyReadableStatusFilter = ({
  database,
  query,
  visibleToActorId
}: {
  database: Knex
  query: Knex.QueryBuilder
  visibleToActorId: string
}) => {
  const clientName = String(database.client.config.client)
  const fallbackFollowersAudienceExpression = {
    sql: clientName.includes('mysql')
      ? "?? = CONCAT(??, '/followers')"
      : "?? = ?? || '/followers'",
    bindings: ['followers_recipients.actorId', 'statuses.actorId']
  }
  const storedFollowersAudienceExpression = {
    sql: `?? = ${statusActorFollowersUrlExpression(database)}`,
    bindings: ['followers_recipients.actorId']
  }
  const applyRecipientlessReplyBaseFilter = (builder: Knex.QueryBuilder) => {
    builder
      .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
      .whereNotExists(function () {
        this.select(database.raw('1'))
          .from('recipients as reply_recipients')
          .whereRaw('?? = ??', ['reply_recipients.statusId', 'statuses.id'])
      })
  }
  const applyRecipientlessReplyParentReferenceFilter = ({
    builder,
    parentReferenceColumn,
    parentReferenceHashColumn
  }: {
    builder: Knex.QueryBuilder
    parentReferenceColumn: string
    parentReferenceHashColumn?: string
  }) => {
    if (parentReferenceHashColumn) {
      builder.whereRaw('?? = ??', [
        'statuses.replyHash',
        parentReferenceHashColumn
      ])
    }
    builder.whereRaw('?? = ??', ['statuses.reply', parentReferenceColumn])
  }
  const applyRecipientlessReplyParentAuthorFilter = (
    builder: Knex.QueryBuilder,
    parentReferenceColumn: string,
    parentReferenceHashColumn?: string
  ) => {
    builder
      .select(database.raw('1'))
      .from('statuses as reply_parent_statuses')
      .where('reply_parent_statuses.actorId', visibleToActorId)
    applyRecipientlessReplyParentReferenceFilter({
      builder,
      parentReferenceColumn,
      parentReferenceHashColumn
    })
  }
  const applyRecipientlessReplyParentConversationParticipantFilter = (
    builder: Knex.QueryBuilder,
    parentReferenceColumn: string,
    parentReferenceHashColumn?: string
  ) => {
    builder
      .select(database.raw('1'))
      .from('statuses as reply_parent_statuses')
      .innerJoin(
        'direct_conversation_statuses as reply_parent_direct_statuses',
        'reply_parent_direct_statuses.statusId',
        'reply_parent_statuses.id'
      )
      .innerJoin(
        'direct_conversation_participants as reply_parent_direct_participants',
        'reply_parent_direct_participants.conversationId',
        'reply_parent_direct_statuses.conversationId'
      )
      .where('reply_parent_direct_participants.actorId', visibleToActorId)
    applyRecipientlessReplyParentReferenceFilter({
      builder,
      parentReferenceColumn,
      parentReferenceHashColumn
    })
  }

  return query.where((qb) => {
    qb.whereIn(
      'statuses.id',
      database('recipients')
        .select('statusId')
        .whereIn('recipients.actorId', [
          ...PUBLIC_ACTIVITY_RECIPIENTS,
          visibleToActorId
        ])
    )
      .orWhere('statuses.actorId', visibleToActorId)
      .orWhere((recipientlessReplyQb) => {
        applyRecipientlessReplyBaseFilter(recipientlessReplyQb)
        recipientlessReplyQb.andWhere((parentVisibilityQb) => {
          parentVisibilityQb
            .whereExists(function () {
              applyRecipientlessReplyParentAuthorFilter(
                this,
                'reply_parent_statuses.id'
              )
            })
            .orWhereExists(function () {
              applyRecipientlessReplyParentAuthorFilter(
                this,
                'reply_parent_statuses.url',
                'reply_parent_statuses.urlHash'
              )
            })
            .orWhereExists(function () {
              applyRecipientlessReplyParentConversationParticipantFilter(
                this,
                'reply_parent_statuses.id'
              )
            })
            .orWhereExists(function () {
              applyRecipientlessReplyParentConversationParticipantFilter(
                this,
                'reply_parent_statuses.url',
                'reply_parent_statuses.urlHash'
              )
            })
        })
      })
      .orWhereExists(function () {
        this.select(database.raw('1'))
          .from('recipients as followers_recipients')
          .leftJoin(
            'actors as status_actors',
            'status_actors.id',
            'statuses.actorId'
          )
          .whereRaw('?? = ??', ['followers_recipients.statusId', 'statuses.id'])
          .where(function () {
            this.whereRaw(
              storedFollowersAudienceExpression.sql,
              storedFollowersAudienceExpression.bindings
            ).orWhereRaw(
              fallbackFollowersAudienceExpression.sql,
              fallbackFollowersAudienceExpression.bindings
            )
          })
          .whereExists(function () {
            this.select(database.raw('1'))
              .from('follows')
              .where('follows.actorId', visibleToActorId)
              .whereRaw('?? = ??', [
                'follows.targetActorId',
                'statuses.actorId'
              ])
              .where('follows.status', FollowStatus.enum.Accepted)
          })
      })
  })
}
