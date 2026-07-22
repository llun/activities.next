import crypto from 'crypto'

import {
  getExplicitMentions,
  getMentionTagsForStatus,
  getVisibilityFromReplyStatus,
  persistEmojiTagsForStatus,
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

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
  application
}: CreatePollFromUserInputParams) => {
  const config = getConfig()
  const span = getSpan('actions', 'createPollFromUser', {
    replyStatusId
  })
  const replyStatus = replyStatusId
    ? await database.getStatus({ statusId: replyStatusId, withReplies: false })
    : null

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
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
    span.end()
    return null
  }
  const recipientMentions =
    effectiveVisibility === 'direct' &&
    replyStatus &&
    replyVisibility !== 'direct'
      ? explicitMentions
      : mentions

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
    replyVisibility
  )
  const mentionTags = getMentionTagsForStatus({
    mentions,
    currentActor,
    replyStatus,
    effectiveVisibility,
    replyVisibility
  })

  const createdPoll = await database.createPoll({
    id: statusId,
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,
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
    applicationWebsite: application?.website ?? null
  })

  // Content-detected language, stored separately from the declared `language`
  // above so the Translate gate can fall back to it when the author's
  // declared/default language doesn't match what they actually wrote.
  await persistDetectedLanguage({ database, statusId, text })

  await Promise.all([
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

  await persistEmojiTagsForStatus({ database, statusId, text })

  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status) {
    span.end()
    return null
  }

  span.end()
  return status
}
