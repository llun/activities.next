import { Knex } from 'knex'

import { searchQueries } from '@/lib/database/domains/search/queries'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { kyselyFor } from '@/lib/database/kysely'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValue,
  deleteCounterValues,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import {
  chunkArray,
  deleteRowsByColumnChunks,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import {
  selectHashtagTagsByStatusIds,
  selectPubliclyAddressedStatusIds
} from '@/lib/database/sql/utils/status'
import { DeleteActorDataParams } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

// The rest of the actor domain is Kysely, in lib/database/domains/actor/.
// deleteActorData stays on Knex until it is ported with status deletion: one
// transaction over every table that holds the actor's data. Its calls into the
// ported search code take kyselyFor(trx).
export type { SQLActorDatabase } from '@/lib/database/domains/actor/types'

const getStatusUrlHash = (url: string): string => getHashFromString(url)

export const deleteActorData = async (
  database: Knex,
  { actorId }: DeleteActorDataParams
): Promise<void> => {
  const affectedHashtags: string[] = []

  await database.transaction(async (trx) => {
    const currentTime = new Date()

    const persistedActor = await trx('actors')
      .where('id', actorId)
      .first<{ accountId: string | null }>('accountId')

    const actorStatuses = await trx('statuses')
      .where('actorId', actorId)
      .select('id', 'type', 'reply', 'content', 'originalStatusId')

    const statusIds = actorStatuses.map((status) => status.id)
    // Reply and hashtag counters only ever counted publicly addressed
    // statuses; read which ones those were while their recipients remain.
    const publiclyAddressedStatusIds = await selectPubliclyAddressedStatusIds(
      trx,
      statusIds
    )
    const statusReferenceToId = new Map<string, string>()
    const replyReferences = Array.from(
      new Set(
        actorStatuses
          .map((status) => status.reply)
          .filter((reply): reply is string => Boolean(reply))
      )
    )
    if (replyReferences.length > 0) {
      const replyReferenceHashes = Array.from(
        new Set(replyReferences.map((reply) => getStatusUrlHash(reply)))
      )
      const parentStatuses = await trx('statuses')
        .whereIn('id', replyReferences)
        .orWhere((builder) =>
          builder
            .whereIn('urlHash', replyReferenceHashes)
            .whereIn('url', replyReferences)
        )
        .select('id', 'url')

      for (const parentStatus of parentStatuses) {
        statusReferenceToId.set(parentStatus.id, parentStatus.id)
        if (parentStatus.url) {
          statusReferenceToId.set(parentStatus.url, parentStatus.id)
        }
      }
    }

    if (actorStatuses.length > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalStatus(actorId),
        actorStatuses.length,
        currentTime
      )
      await decreaseCounterValue(
        trx,
        CounterKey.serviceTotalStatuses(),
        actorStatuses.length,
        currentTime
      )
    }

    if (persistedActor?.accountId) {
      await decreaseCounterValue(
        trx,
        CounterKey.serviceTotalActors(),
        1,
        currentTime
      )
    }

    const reblogCounterChanges: Record<string, number> = {}
    const replyCounterChanges: Record<string, number> = {}
    for (const status of actorStatuses) {
      if (status.type === 'Announce') {
        const content = parseStatusContent(status.content)
        const originalStatusId =
          typeof status.originalStatusId === 'string'
            ? status.originalStatusId
            : typeof content === 'string'
              ? content
              : typeof content?.url === 'string'
                ? content.url
                : typeof status.content === 'string'
                  ? status.content
                  : null

        if (originalStatusId) {
          reblogCounterChanges[originalStatusId] =
            (reblogCounterChanges[originalStatusId] || 0) + 1
        }
      }

      if (status.reply && publiclyAddressedStatusIds.has(status.id)) {
        const parentStatusId = statusReferenceToId.get(status.reply)
        if (parentStatusId) {
          replyCounterChanges[parentStatusId] =
            (replyCounterChanges[parentStatusId] || 0) + 1
        }
      }
    }

    for (const [statusId, count] of Object.entries(reblogCounterChanges)) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalReblog(statusId),
        count,
        currentTime
      )
    }
    for (const [statusId, count] of Object.entries(replyCounterChanges)) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalReply(statusId),
        count,
        currentTime
      )
    }

    const acceptedFollowing = await trx('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .select('targetActorId')

    if (acceptedFollowing.length > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalFollowing(actorId),
        acceptedFollowing.length,
        currentTime
      )

      const followerAdjustments: Record<string, number> = {}
      for (const follow of acceptedFollowing) {
        followerAdjustments[follow.targetActorId] =
          (followerAdjustments[follow.targetActorId] || 0) + 1
      }
      for (const [targetActorId, count] of Object.entries(
        followerAdjustments
      )) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowers(targetActorId),
          count,
          currentTime
        )
      }
    }

    const acceptedFollowers = await trx('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .select('actorId')
    if (acceptedFollowers.length > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalFollowers(actorId),
        acceptedFollowers.length,
        currentTime
      )

      const followingAdjustments: Record<string, number> = {}
      for (const follow of acceptedFollowers) {
        followingAdjustments[follow.actorId] =
          (followingAdjustments[follow.actorId] || 0) + 1
      }

      for (const [followerActorId, count] of Object.entries(
        followingAdjustments
      )) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowing(followerActorId),
          count,
          currentTime
        )
      }
    }

    const likesMadeByActor = await trx('likes')
      .where('actorId', actorId)
      .select('statusId')
    const likeAdjustments: Record<string, number> = {}
    for (const like of likesMadeByActor) {
      likeAdjustments[like.statusId] = (likeAdjustments[like.statusId] || 0) + 1
    }
    for (const [statusId, count] of Object.entries(likeAdjustments)) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalLike(statusId),
        count,
        currentTime
      )
    }

    const medias = await trx('medias')
      .where('actorId', actorId)
      .select('originalBytes', 'thumbnailBytes')
    const totalMediaBytes = medias.reduce(
      (sum, media) =>
        sum +
        parseCounterValue(media.originalBytes) +
        parseCounterValue(media.thumbnailBytes),
      0
    )
    if (persistedActor?.accountId && totalMediaBytes > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.mediaUsage(persistedActor.accountId),
        totalMediaBytes,
        currentTime
      )
    }

    if (statusIds.length > 0) {
      const hashtagTags = await selectHashtagTagsByStatusIds(trx, statusIds)
      affectedHashtags.push(...hashtagTags.map((tag) => tag.name))
      const hashtagCounterAdjustments = new Map<string, number>()
      for (const tag of hashtagTags) {
        if (!publiclyAddressedStatusIds.has(tag.statusId)) continue
        const tagName = normalizeHashtagSearchName(tag.name)
        if (tagName.length === 0) continue
        hashtagCounterAdjustments.set(
          tagName,
          (hashtagCounterAdjustments.get(tagName) ?? 0) + 1
        )
      }
      for (const [tagName, count] of hashtagCounterAdjustments) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalHashtag(tagName),
          count,
          currentTime
        )
      }

      // Delete status-related data
      await deleteRowsByColumnChunks(trx, 'tags', 'statusId', statusIds)
      await deleteRowsByColumnChunks(trx, 'recipients', 'statusId', statusIds)
      await deleteRowsByColumnChunks(trx, 'likes', 'statusId', statusIds)
      await deleteRowsByColumnChunks(
        trx,
        'status_reactions',
        'statusId',
        statusIds
      )
      await deleteRowsByColumnChunks(trx, 'bookmarks', 'statusId', statusIds)
      await deleteRowsByColumnChunks(trx, 'attachments', 'statusId', statusIds)
      await deleteRowsByColumnChunks(
        trx,
        'status_history',
        'statusId',
        statusIds
      )
      // Same rule as the status-deletion path: only the status→card link
      // goes, never the shared per-url cache. Without it a purged actor
      // leaves one orphan row per status forever, and because `statusId` is
      // the deterministic ActivityPub id, a re-ingested remote status would
      // come back wearing its old card with no fetch at all.
      await deleteRowsByColumnChunks(
        trx,
        'status_link_previews',
        'statusId',
        statusIds
      )
      await deleteRowsByColumnChunks(trx, 'poll_answers', 'statusId', statusIds)
      await deleteRowsByColumnChunks(trx, 'poll_voters', 'statusId', statusIds)
      await deleteRowsByColumnChunks(trx, 'poll_choices', 'statusId', statusIds)
      await deleteRowsByColumnChunks(
        trx,
        'notifications',
        'statusId',
        statusIds
      )
      await deleteRowsByColumnChunks(
        trx,
        'direct_conversation_statuses',
        'statusId',
        statusIds
      )
      for (const statusIdChunk of chunkArray(
        statusIds,
        getWhereInBatchSize(trx)
      )) {
        await trx('fitness_files')
          .whereIn('statusId', statusIdChunk)
          .update({ statusId: null })
      }
    }

    // Delete timeline entries for this actor
    await trx('timelines').where('actorId', actorId).delete()
    await trx('timelines').where('statusActorId', actorId).delete()

    // Delete statuses
    await trx('statuses').where('actorId', actorId).delete()
    if (statusIds.length > 0) {
      await deleteStatusSearchDocumentsByStatusIds(kyselyFor(trx), statusIds)
    }

    // Delete follows (both directions)
    await trx('follows').where('actorId', actorId).delete()
    await trx('follows').where('targetActorId', actorId).delete()

    // Delete list memberships holding the actor and the lists it owns, as
    // removeListAccounts / deleteList do (their `list:<id>` feed rows went
    // with the actorId/statusActorId timelines sweep above). Kept after the
    // follows delete, the same follows → list_accounts order
    // updateFollowStatus writes in.
    await trx('list_accounts').where('targetActorId', actorId).delete()
    const ownedListIds: string[] = await trx('lists')
      .where('actorId', actorId)
      .pluck('id')
    await deleteRowsByColumnChunks(trx, 'list_accounts', 'listId', ownedListIds)
    await trx('lists').where('actorId', actorId).delete()

    // Delete endorsements (both as endorser and endorsed)
    await trx('endorsements').where('actorId', actorId).delete()
    await trx('endorsements').where('targetActorId', actorId).delete()

    // Delete the actor's featured tags.
    await trx('featured_tags').where('actorId', actorId).delete()

    const blocks = await trx('blocks')
      .where('actorId', actorId)
      .orWhere('targetActorId', actorId)
      .select('actorId', 'targetActorId')
    const blockingAdjustments: Record<string, number> = {}
    const blockedByAdjustments: Record<string, number> = {}
    for (const block of blocks) {
      if (block.actorId !== actorId) {
        blockingAdjustments[block.actorId] =
          (blockingAdjustments[block.actorId] || 0) + 1
      }
      if (block.targetActorId !== actorId) {
        blockedByAdjustments[block.targetActorId] =
          (blockedByAdjustments[block.targetActorId] || 0) + 1
      }
    }
    await Promise.all([
      ...Object.entries(blockingAdjustments).map(([blockingActorId, count]) =>
        decreaseCounterValue(
          trx,
          CounterKey.totalBlocking(blockingActorId),
          count,
          currentTime
        )
      ),
      ...Object.entries(blockedByAdjustments).map(([blockedActorId, count]) =>
        decreaseCounterValue(
          trx,
          CounterKey.totalBlockedBy(blockedActorId),
          count,
          currentTime
        )
      )
    ])
    await trx('blocks')
      .where((builder) => {
        builder.where('actorId', actorId).orWhere('targetActorId', actorId)
      })
      .delete()

    await trx('mutes')
      .where((builder) => {
        builder.where('actorId', actorId).orWhere('targetActorId', actorId)
      })
      .delete()

    // Private account notes reference the actor on either side (author or
    // target); remove both so a recreated actor URL cannot resurface them.
    await trx('account_notes')
      .where((builder) => {
        builder.where('actorId', actorId).orWhere('targetActorId', actorId)
      })
      .delete()

    // Subquery avoids hitting the SQLite 999-parameter limit when an
    // actor has accumulated many filters; the mute precedent only
    // touches one table per actor so doesn't need this.
    await trx('filter_statuses')
      .whereIn('filterId', function () {
        this.select('id').from('filters').where('actorId', actorId)
      })
      .delete()
    await trx('filter_keywords')
      .whereIn('filterId', function () {
        this.select('id').from('filters').where('actorId', actorId)
      })
      .delete()
    await trx('filters').where('actorId', actorId).delete()

    // Delete likes made by this actor
    await trx('likes').where('actorId', actorId).delete()

    // Delete emoji reactions made by this actor, so a recreated actor URL
    // cannot resurface them as the new owner's own reactions.
    await trx('status_reactions').where('actorId', actorId).delete()

    // Delete bookmarks made by this actor
    await trx('bookmarks').where('actorId', actorId).delete()

    // Delete markers made by this actor
    await trx('markers').where('actorId', actorId).delete()

    const pollAnswersMadeByActor: { statusId: string; choice: number }[] =
      await trx('poll_answers')
        .where('actorId', actorId)
        .select('statusId', 'choice')
    if (pollAnswersMadeByActor.length > 0) {
      const choiceIdsByStatusId = new Map<string, number[]>()
      const votedStatusIds = [
        ...new Set(pollAnswersMadeByActor.map((answer) => answer.statusId))
      ]

      for (const statusIdChunk of chunkArray(
        votedStatusIds,
        getWhereInBatchSize(trx)
      )) {
        const pollChoices: { statusId: string; choiceId: number }[] = await trx(
          'poll_choices'
        )
          .whereIn('statusId', statusIdChunk)
          .orderBy('statusId', 'asc')
          .orderBy('choiceId', 'asc')
          .select('statusId', 'choiceId')

        for (const choice of pollChoices) {
          const choices = choiceIdsByStatusId.get(choice.statusId) ?? []
          choices.push(choice.choiceId)
          choiceIdsByStatusId.set(choice.statusId, choices)
        }
      }

      const pollChoiceDecrements = new Map<
        string,
        { statusId: string; choiceId: number; count: number }
      >()
      for (const answer of pollAnswersMadeByActor) {
        const choiceId = choiceIdsByStatusId.get(answer.statusId)?.[
          Number(answer.choice)
        ]
        if (choiceId === undefined) continue

        const key = `${answer.statusId}:${choiceId}`
        const existing = pollChoiceDecrements.get(key) ?? {
          statusId: answer.statusId,
          choiceId,
          count: 0
        }
        existing.count += 1
        pollChoiceDecrements.set(key, existing)
      }

      for (const {
        statusId,
        choiceId,
        count
      } of pollChoiceDecrements.values()) {
        await trx('poll_choices')
          .where({ statusId, choiceId })
          .update({
            totalVotes: trx.raw('CASE WHEN ?? > ? THEN ?? - ? ELSE 0 END', [
              'totalVotes',
              count,
              'totalVotes',
              count
            ])
          })
      }
    }

    // Delete poll votes cast by this actor on other actors' polls
    await trx('poll_answers').where('actorId', actorId).delete()
    await trx('poll_voters').where('actorId', actorId).delete()

    // Delete attachments created by this actor
    await trx('attachments').where('actorId', actorId).delete()

    // Delete the actor's gallery albums before their media (SQLite runs
    // without the foreign keys that cascade these on PostgreSQL).
    await trx('gallery_album_items').where('actorId', actorId).delete()
    await trx('gallery_albums').where('actorId', actorId).delete()

    // Delete medias created by this actor
    await trx('medias').where('actorId', actorId).delete()

    await deleteCounterValue(trx, CounterKey.totalStatus(actorId))
    await deleteCounterValue(trx, CounterKey.totalFollowers(actorId))
    await deleteCounterValue(trx, CounterKey.totalFollowing(actorId))
    await deleteCounterValue(trx, CounterKey.totalBlocking(actorId))
    await deleteCounterValue(trx, CounterKey.totalBlockedBy(actorId))
    await deleteCounterValue(trx, CounterKey.remoteCountsSyncedAt(actorId))

    if (persistedActor?.accountId) {
      await decreaseCounterValue(
        trx,
        CounterKey.nodeinfoTotalUsers(),
        1,
        currentTime
      )
      if (actorStatuses.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.nodeinfoLocalPosts(),
          actorStatuses.length,
          currentTime
        )
      }
    }

    await deleteCounterValues(
      trx,
      statusIds.flatMap((statusId) => [
        CounterKey.totalLike(statusId),
        CounterKey.totalReblog(statusId),
        CounterKey.totalReply(statusId)
      ])
    )

    // Delete notifications table entries if exists
    try {
      await trx('notifications').where('actorId', actorId).delete()
      await trx('notifications').where('sourceActorId', actorId).delete()
    } catch {
      // Table might not exist in older migrations
    }

    // Finally delete the actor
    await trx('actors').where('id', actorId).delete()
    await searchQueries.deleteActorSearchDocument(kyselyFor(trx), {
      id: actorId
    })
  })

  if (affectedHashtags.length > 0) {
    try {
      await searchQueries.indexHashtagSearchDocuments(kyselyFor(database), {
        hashtags: [...new Set(affectedHashtags)]
      })
    } catch (err) {
      logger.warn(
        {
          actorId,
          err,
          hashtags: [...new Set(affectedHashtags)]
        },
        'Failed to refresh hashtag search documents after actor deletion'
      )
    }
  }
}
