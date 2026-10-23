import {
  discardFailedStatusCreate,
  getExplicitMentions,
  getMentionTagsForStatus,
  getVisibilityFromReplyStatus,
  loadIdempotentStatus,
  persistEmojiTagsForStatus,
  publishCreatedStatus,
  resolveExistingIdempotentStatus,
  runBestEffortStep,
  settleAll,
  statusRecipientsCC,
  statusRecipientsTo,
  trackInFlightStatusCreation
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getCommunityForNewReply } from '@/lib/services/federation/replyCommunity'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { getMentions } from '@/lib/utils/text/getMentions'
import { withSpan } from '@/lib/utils/trace'

interface CreatePollFromUserInputParams {
  text: string
  summary?: string | null
  replyStatusId?: string
  currentActor: Actor
  choices: string[]
  database: Database
  endAt: number
  pollType?: 'oneOf' | 'anyOf'
  // Mastodon poll[hide_totals]: hide per-option tallies until the poll expires.
  hideTotals?: boolean
  visibility?: MastodonVisibility
  sensitive?: boolean
  language?: string | null
  // The registered OAuth client (Mastodon "application") that authored the
  // status, when created via an app token. Omitted for web-session creates.
  application?: { name: string; website: string | null }
  // Backdate the status (ms since epoch); omitted means now. The publicId is
  // minted from this time so id order keeps matching createdAt order.
  createdAt?: number
  idempotency?: { key: string; contentHash: string }
}
export const createPollFromUserInput = async ({
  text,
  summary,
  replyStatusId,
  currentActor,
  choices = [],
  database,
  endAt,
  pollType,
  hideTotals = false,
  visibility,
  sensitive = false,
  language = null,
  application,
  createdAt,
  idempotency
}: CreatePollFromUserInputParams) =>
  withSpan('actions', 'createPollFromUser', { replyStatusId }, async () => {
    if (idempotency) {
      const existing = await resolveExistingIdempotentStatus({
        database,
        actorId: currentActor.id,
        idempotency
      })
      if (existing) return existing
    }

    const config = getConfig()
    const replyStatus = replyStatusId
      ? await database.getStatus({
          statusId: replyStatusId,
          withReplies: false
        })
      : null
    // Same guard as createNoteFromUserInput: a reply inherits its parent's
    // audience, so the author must be able to read the parent.
    if (
      replyStatus &&
      !(await canActorReadStatus({
        database,
        status: replyStatus,
        currentActor
      }))
    ) {
      return null
    }

    const postId = generatePublicId(createdAt)
    const statusId = getLocalStatusId({
      actorId: currentActor.id,
      statusId: postId
    })
    const mentions = await getMentions({ text, currentActor, replyStatus })
    const explicitMentions = getExplicitMentions(text, mentions)

    // Determine effective visibility:
    // 1. Use explicit visibility if provided
    // 2. Inherit from reply status if replying
    // 3. Default to 'public'
    const replyVisibility = getVisibilityFromReplyStatus(replyStatus)
    const effectiveVisibility = visibility ?? replyVisibility ?? 'public'
    const isReplyingToDirectThread = replyStatus && replyVisibility === 'direct'
    if (
      effectiveVisibility === 'direct' &&
      explicitMentions.length === 0 &&
      !isReplyingToDirectThread
    ) {
      return null
    }
    const recipientMentions =
      effectiveVisibility === 'direct' &&
      replyStatus &&
      replyVisibility !== 'direct'
        ? explicitMentions
        : mentions

    const communityActorId = await getCommunityForNewReply({
      database,
      replyStatus,
      visibility: effectiveVisibility
    })

    const to = statusRecipientsTo(
      currentActor,
      recipientMentions,
      replyStatus,
      effectiveVisibility,
      replyVisibility
    )
    const cc = statusRecipientsCC(
      currentActor,
      recipientMentions,
      replyStatus,
      effectiveVisibility,
      replyVisibility,
      communityActorId
    )
    const mentionTags = getMentionTagsForStatus({
      mentions,
      currentActor,
      replyStatus,
      effectiveVisibility,
      replyVisibility
    })

    const finishInFlight = trackInFlightStatusCreation(statusId)
    let createdPoll: Status
    let isNew = true
    try {
      const createParams = {
        id: statusId,
        url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,
        publicId: postId,
        actorId: currentActor.id,
        text: convertMarkdownText(config.host)(text),
        summary: summary?.trim() || null,
        to,
        cc,
        reply: replyStatus?.id || '',
        choices,
        endAt,
        pollType,
        hideTotals,
        // A sensitized actor's new statuses are forced sensitive at creation, so
        // the flag is persisted and federated copies inherit it (Admin moderation).
        sensitive: sensitive || Boolean(currentActor.sensitizedAt),
        language,
        applicationName: application?.name ?? null,
        applicationWebsite: application?.website ?? null,
        createdAt,
        ...(idempotency ? { idempotency } : {})
      }
      if (idempotency) {
        const result = await database.createPollWithResult(createParams)
        createdPoll = result.status
        isNew = result.isNew
      } else {
        createdPoll = await database.createPoll(createParams)
      }
    } catch (error) {
      finishInFlight()
      throw error
    }

    if (!isNew && idempotency) {
      finishInFlight()
      const existing = await loadIdempotentStatus({
        database,
        actorId: currentActor.id,
        key: idempotency.key,
        statusId: createdPoll.id
      })
      // The winner's create failed and was discarded; the client retries.
      if (!existing) {
        throw new Error('Concurrent create with this Idempotency-Key failed')
      }
      return existing
    }

    // As in createNoteFromUserInput: a failed completion step discards the
    // poll and fails the request; best-effort steps only log.
    let poll: Status
    try {
      try {
        // Content-detected language, stored separately from the declared
        // `language` above so the Translate gate can fall back to it when the
        // author's declared/default language doesn't match what they actually
        // wrote.
        await runBestEffortStep(statusId, 'detected language', () =>
          persistDetectedLanguage({
            database,
            statusId,
            text,
            declaredLanguage: language
          })
        )

        await settleAll([
          addStatusToTimelines(database, createdPoll),
          ...mentionTags.map((mention) =>
            database.createTag({
              statusId,
              name: mention.name || '',
              value: mention.href,
              type: 'mention'
            })
          )
        ])

        await persistEmojiTagsForStatus({
          database,
          statusId,
          text: [text, summary ?? '', ...choices]
        })

        const hydratedPoll = await database.getStatus({
          statusId,
          withReplies: false
        })
        if (!hydratedPoll) {
          throw new Error('The created poll could not be loaded')
        }
        poll = hydratedPoll
      } catch (error) {
        throw await discardFailedStatusCreate({
          database,
          actorId: currentActor.id,
          statusId,
          idempotency,
          error
        })
      }
      // A poll queues no job at creation; this marks its key 'complete'.
      await publishCreatedStatus({
        database,
        actorId: currentActor.id,
        status: poll,
        idempotency
      })
    } finally {
      finishInFlight()
    }
    return poll
  })
