import { sql } from 'kysely'

import type { DeleteActorDataParams } from '@/lib/database/domains/actor/types'
import { searchQueries } from '@/lib/database/domains/search/queries'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { selectPubliclyAddressedStatusIds } from '@/lib/database/domains/status/deletion'
import { selectHashtagTagsByStatusIds } from '@/lib/database/domains/status/hashtags'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  deleteCounterValue,
  deleteCounterValues
} from '@/lib/database/kysely/counter'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { CounterKey, parseCounterValue } from '@/lib/database/utils/counter'
import { parseStatusContent } from '@/lib/database/utils/parseStatusContent'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

// Purges everything an actor left behind, in one transaction over every table
// that holds the actor's data: its statuses and the rows that hang off them,
// its follows, lists, endorsements, featured tags, blocks, mutes, notes,
// filters, likes, reactions, bookmarks, markers, poll votes, attachments,
// albums and media, the counters all of these moved, and last the actor row
// and its search document. The hashtag search documents its tags fed are
// refreshed after the transaction commits, best effort.

// Runs `run` once per chunk of `values`, one after the other, each chunk as
// long as one `in (…)` list may be.
const forEachChunk = async <Value>(
  db: Db,
  values: Value[],
  run: (chunk: Value[]) => Promise<unknown>
) => {
  for (const chunk of chunkArray(values, getWhereInBatchSize(db))) {
    await run(chunk)
  }
}

export const deleteActorData = async (
  db: Db,
  { actorId }: DeleteActorDataParams
): Promise<void> => {
  const affectedHashtags: string[] = []

  await inTransaction(db, async (trx) => {
    const currentTime = new Date()

    const persistedActor = await trx
      .selectFrom('actors')
      .select('accountId')
      .where('id', '=', actorId)
      .limit(1)
      .executeTakeFirst()

    const actorStatuses = await trx
      .selectFrom('statuses')
      .select(['id', 'type', 'reply', 'content', 'originalStatusId'])
      .where('actorId', '=', actorId)
      .$narrowType<{ id: string }>()
      .execute()

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
        new Set(replyReferences.map((reply) => getHashFromString(reply)))
      )
      // One statement, unchunked, as before.
      const parentStatuses = await trx
        .selectFrom('statuses')
        .select(['id', 'url'])
        .where((eb) =>
          eb.or([
            eb('id', 'in', replyReferences),
            eb.and([
              eb('urlHash', 'in', replyReferenceHashes),
              eb('url', 'in', replyReferences)
            ])
          ])
        )
        .$narrowType<{ id: string }>()
        .execute()

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
        // Not getAnnounceOriginalStatusId: an empty `originalStatusId` stops
        // here, and only the content's `url` is read, as before.
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

    const acceptedFollowing = await trx
      .selectFrom('follows')
      .select('targetActorId')
      .where('actorId', '=', actorId)
      .where('status', '=', 'Accepted')
      .$narrowType<{ targetActorId: string }>()
      .execute()

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

    const acceptedFollowers = await trx
      .selectFrom('follows')
      .select('actorId')
      .where('targetActorId', '=', actorId)
      .where('status', '=', 'Accepted')
      .$narrowType<{ actorId: string }>()
      .execute()
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

    const likesMadeByActor = await trx
      .selectFrom('likes')
      .select('statusId')
      .where('actorId', '=', actorId)
      .execute()
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

    const medias = await trx
      .selectFrom('medias')
      .select(['originalBytes', 'thumbnailBytes'])
      .where('actorId', '=', actorId)
      .execute()
    // A photo edit keeps the uploaded file and earlier renders beside the
    // live one; they count toward the usage too.
    const editFiles = await trx
      .selectFrom('media_edit_files')
      .select('bytes')
      .where(
        'mediaId',
        'in',
        trx.selectFrom('medias').select('id').where('actorId', '=', actorId)
      )
      .execute()
    const totalMediaBytes =
      medias.reduce(
        (sum, media) =>
          sum +
          parseCounterValue(media.originalBytes) +
          parseCounterValue(media.thumbnailBytes),
        0
      ) +
      editFiles.reduce((sum, file) => sum + parseCounterValue(file.bytes), 0)
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

      const deleteByStatusIds = (
        remove: (chunk: string[]) => Promise<unknown>
      ) => forEachChunk(trx, statusIds, remove)

      // Delete status-related data
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('tags').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('recipients').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('likes').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx
          .deleteFrom('status_reactions')
          .where('statusId', 'in', chunk)
          .execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('bookmarks').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('attachments').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx
          .deleteFrom('status_history')
          .where('statusId', 'in', chunk)
          .execute()
      )
      // Same rule as the status-deletion path: only the status→card link
      // goes, never the shared per-url cache. Without it a purged actor
      // leaves one orphan row per status forever, and because `statusId` is
      // the deterministic ActivityPub id, a re-ingested remote status would
      // come back wearing its old card with no fetch at all.
      await deleteByStatusIds((chunk) =>
        trx
          .deleteFrom('status_link_previews')
          .where('statusId', 'in', chunk)
          .execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('poll_answers').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('poll_voters').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('poll_choices').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx.deleteFrom('notifications').where('statusId', 'in', chunk).execute()
      )
      await deleteByStatusIds((chunk) =>
        trx
          .deleteFrom('direct_conversation_statuses')
          .where('statusId', 'in', chunk)
          .execute()
      )
      await deleteByStatusIds((chunk) =>
        trx
          .updateTable('fitness_files')
          .set({ statusId: null })
          .where('statusId', 'in', chunk)
          .execute()
      )
    }

    // Delete timeline entries for this actor
    await trx.deleteFrom('timelines').where('actorId', '=', actorId).execute()
    await trx
      .deleteFrom('timelines')
      .where('statusActorId', '=', actorId)
      .execute()

    // Delete statuses
    await trx.deleteFrom('statuses').where('actorId', '=', actorId).execute()
    if (statusIds.length > 0) {
      await deleteStatusSearchDocumentsByStatusIds(trx, statusIds)
    }

    // Delete follows (both directions)
    await trx.deleteFrom('follows').where('actorId', '=', actorId).execute()
    await trx
      .deleteFrom('follows')
      .where('targetActorId', '=', actorId)
      .execute()

    // Delete list memberships holding the actor and the lists it owns, as
    // removeListAccounts / deleteList do (their `list:<id>` feed rows went
    // with the actorId/statusActorId timelines sweep above). Kept after the
    // follows delete, the same follows → list_accounts order
    // updateFollowStatus writes in.
    await trx
      .deleteFrom('list_accounts')
      .where('targetActorId', '=', actorId)
      .execute()
    const ownedListIds = (
      await trx
        .selectFrom('lists')
        .select('id')
        .where('actorId', '=', actorId)
        .execute()
    ).map((list) => list.id)
    await forEachChunk(trx, ownedListIds, (chunk) =>
      trx.deleteFrom('list_accounts').where('listId', 'in', chunk).execute()
    )
    await trx.deleteFrom('lists').where('actorId', '=', actorId).execute()

    // Delete endorsements (both as endorser and endorsed)
    await trx
      .deleteFrom('endorsements')
      .where('actorId', '=', actorId)
      .execute()
    await trx
      .deleteFrom('endorsements')
      .where('targetActorId', '=', actorId)
      .execute()

    // Delete the actor's featured tags.
    await trx
      .deleteFrom('featured_tags')
      .where('actorId', '=', actorId)
      .execute()

    const blocks = await trx
      .selectFrom('blocks')
      .select(['actorId', 'targetActorId'])
      .where((eb) =>
        eb.or([eb('actorId', '=', actorId), eb('targetActorId', '=', actorId)])
      )
      .execute()
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
    await trx
      .deleteFrom('blocks')
      .where((eb) =>
        eb.or([eb('actorId', '=', actorId), eb('targetActorId', '=', actorId)])
      )
      .execute()

    await trx
      .deleteFrom('mutes')
      .where((eb) =>
        eb.or([eb('actorId', '=', actorId), eb('targetActorId', '=', actorId)])
      )
      .execute()

    // Private account notes reference the actor on either side (author or
    // target); remove both so a recreated actor URL cannot resurface them.
    await trx
      .deleteFrom('account_notes')
      .where((eb) =>
        eb.or([eb('actorId', '=', actorId), eb('targetActorId', '=', actorId)])
      )
      .execute()

    await trx
      .deleteFrom('bulk_import_rows')
      .where(
        'importId',
        'in',
        trx
          .selectFrom('bulk_imports')
          .select('id')
          .where('actorId', '=', actorId)
      )
      .execute()

    await trx
      .deleteFrom('bulk_imports')
      .where('actorId', '=', actorId)
      .execute()

    // Subquery avoids hitting the SQLite 999-parameter limit when an
    // actor has accumulated many filters; the mute precedent only
    // touches one table per actor so doesn't need this.
    await trx
      .deleteFrom('filter_statuses')
      .where(
        'filterId',
        'in',
        trx.selectFrom('filters').select('id').where('actorId', '=', actorId)
      )
      .execute()
    await trx
      .deleteFrom('filter_keywords')
      .where(
        'filterId',
        'in',
        trx.selectFrom('filters').select('id').where('actorId', '=', actorId)
      )
      .execute()
    await trx.deleteFrom('filters').where('actorId', '=', actorId).execute()

    // Delete likes made by this actor
    await trx.deleteFrom('likes').where('actorId', '=', actorId).execute()

    // Delete emoji reactions made by this actor, so a recreated actor URL
    // cannot resurface them as the new owner's own reactions.
    await trx
      .deleteFrom('status_reactions')
      .where('actorId', '=', actorId)
      .execute()

    // Delete bookmarks made by this actor
    await trx.deleteFrom('bookmarks').where('actorId', '=', actorId).execute()

    // Delete markers made by this actor
    await trx.deleteFrom('markers').where('actorId', '=', actorId).execute()

    // Delete this actor's idempotency keys (they hold a hash of each post body)
    await trx
      .deleteFrom('idempotency_keys')
      .where('actorId', '=', actorId)
      .execute()

    const pollAnswersMadeByActor = await trx
      .selectFrom('poll_answers')
      .select(['statusId', 'choice'])
      .where('actorId', '=', actorId)
      .execute()
    if (pollAnswersMadeByActor.length > 0) {
      const choiceIdsByStatusId = new Map<string, number[]>()
      const votedStatusIds = [
        ...new Set(pollAnswersMadeByActor.map((answer) => answer.statusId))
      ]

      await forEachChunk(trx, votedStatusIds, async (statusIdChunk) => {
        const pollChoices = await trx
          .selectFrom('poll_choices')
          .select(['statusId', 'choiceId'])
          .where('statusId', 'in', statusIdChunk)
          .orderBy('statusId', 'asc')
          .orderBy('choiceId', 'asc')
          .$narrowType<{ statusId: string }>()
          .execute()

        for (const choice of pollChoices) {
          const choices = choiceIdsByStatusId.get(choice.statusId) ?? []
          choices.push(choice.choiceId)
          choiceIdsByStatusId.set(choice.statusId, choices)
        }
      })

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
        await trx
          .updateTable('poll_choices')
          .set({
            totalVotes: sql<number>`CASE WHEN ${sql.ref('totalVotes')} > ${count} THEN ${sql.ref('totalVotes')} - ${count} ELSE 0 END`
          })
          .where('statusId', '=', statusId)
          .where('choiceId', '=', choiceId)
          .execute()
      }
    }

    // Delete poll votes cast by this actor on other actors' polls
    await trx
      .deleteFrom('poll_answers')
      .where('actorId', '=', actorId)
      .execute()
    await trx.deleteFrom('poll_voters').where('actorId', '=', actorId).execute()

    // Delete attachments created by this actor
    await trx.deleteFrom('attachments').where('actorId', '=', actorId).execute()

    // Delete the actor's gallery albums before their media (SQLite runs
    // without the foreign keys that cascade these on PostgreSQL).
    await trx
      .deleteFrom('gallery_album_items')
      .where('actorId', '=', actorId)
      .execute()
    await trx
      .deleteFrom('gallery_albums')
      .where('actorId', '=', actorId)
      .execute()

    // Delete the photo edit files of the actor's media before the media
    // (SQLite may run without the foreign key that cascades them).
    await trx
      .deleteFrom('media_edit_files')
      .where(
        'mediaId',
        'in',
        trx.selectFrom('medias').select('id').where('actorId', '=', actorId)
      )
      .execute()

    // Delete medias created by this actor
    await trx.deleteFrom('medias').where('actorId', '=', actorId).execute()

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
      await trx
        .deleteFrom('notifications')
        .where('actorId', '=', actorId)
        .execute()
      await trx
        .deleteFrom('notifications')
        .where('sourceActorId', '=', actorId)
        .execute()
    } catch {
      // Table might not exist in older migrations
    }

    // Finally delete the actor
    await trx.deleteFrom('actors').where('id', '=', actorId).execute()
    // Called through searchQueries, so a test can stand in for it.
    await searchQueries.deleteActorSearchDocument(trx, { id: actorId })
  })

  if (affectedHashtags.length > 0) {
    try {
      await searchQueries.indexHashtagSearchDocuments(db, {
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
