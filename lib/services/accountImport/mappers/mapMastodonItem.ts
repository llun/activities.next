import {
  getContent,
  getLanguage,
  getQuoteTargetId,
  getSummary
} from '@/lib/activities/note'
import {
  buildAttachments,
  buildRecipients,
  buildTags,
  deriveMastodonVisibility,
  deterministicPublicId,
  isDirectMessage,
  normalizeRecipients,
  parsePublished,
  replyReference
} from '@/lib/services/accountImport/mappers/shared'
import type {
  ImportMapperContext,
  ImportMapperResult
} from '@/lib/services/accountImport/mappers/types'
import { mastodonActivitySchema } from '@/lib/services/accountImport/schemas'

export const mapMastodonItem = (
  item: unknown,
  context: ImportMapperContext
): ImportMapperResult => {
  const parsed = mastodonActivitySchema.safeParse(item)
  if (!parsed.success) return { ok: false, reason: 'invalid' }

  const activity = parsed.data
  if (activity.type === 'Announce') return { ok: false, reason: 'boost' }

  const note = activity.object
  // The item must be the archive's own authorship: both the activity actor
  // and, when the note carries one, the note's attributedTo must be the
  // archive's actor.json id. An untrusted archive can carry anyone's source
  // ids; without this check a foreign item would import into the target
  // account under the archive's forged authorship.
  if (
    activity.actor !== context.sourceActorId ||
    (note.attributedTo !== undefined &&
      note.attributedTo !== context.sourceActorId)
  ) {
    return { ok: false, reason: 'foreign-author' }
  }

  const published = parsePublished(
    note.published ?? activity.published,
    context.nowMs
  )
  if (published === null) return { ok: false, reason: 'bad-date' }

  const sourceTo = normalizeRecipients(note.to ?? activity.to)
  const sourceCc = normalizeRecipients(note.cc ?? activity.cc)
  const tags = Array.isArray(note.tag) ? note.tag : note.tag ? [note.tag] : []
  const importedTags = buildTags(
    tags.map((tag) => ({
      type: tag.type,
      name: tag.name,
      href: tag.href,
      iconUrl: tag.icon?.url
    }))
  )

  const parentId =
    typeof note.inReplyTo === 'string'
      ? note.inReplyTo
      : (note.inReplyTo?.id ?? null)
  const reply = replyReference(parentId, context)
  if (!reply.ok) return reply

  const visibility = deriveMastodonVisibility(
    sourceTo,
    sourceCc,
    context.sourceFollowersUrl
  )

  if (
    isDirectMessage(
      sourceTo,
      sourceCc,
      context.sourceFollowersUrl,
      context.sourceActorId
    )
  ) {
    return { ok: false, reason: 'direct' }
  }

  const mentions = importedTags
    .filter((tag) => tag.type === 'mention')
    .map((tag) => ({
      type: 'Mention' as const,
      href: tag.value,
      name: tag.name
    }))
  const targetRecipients = buildRecipients(context.actor, mentions, visibility)
  const quoteTarget = getQuoteTargetId(note as never)
  const quoteSourceId =
    quoteTarget && context.ownStatusIds.has(quoteTarget) ? quoteTarget : null
  const sourceAttachments = Array.isArray(note.attachment)
    ? note.attachment
    : note.attachment
      ? [note.attachment]
      : []
  const pollChoices = note.anyOf ?? note.oneOf ?? []
  const pollEndAt = note.endTime ?? note.closed

  return {
    ok: true,
    input: {
      sourceId: note.id,
      sourceUrl:
        typeof note.url === 'string'
          ? note.url
          : Array.isArray(note.url)
            ? ((note.url.find((part) => typeof part === 'string') as
                string | undefined) ?? null)
            : (note.url?.href ?? null),
      publicId: deterministicPublicId(context.actor.id, note.id, published),
      published,
      visibility,
      ...targetRecipients,
      text: getContent(note as never),
      summary: getSummary(note as never) || null,
      sensitive: note.sensitive ?? false,
      language: getLanguage(note as never),
      replyToStatusId: reply.replyToStatusId,
      externalReplyUri: reply.externalReplyUri,
      quoteSourceId,
      quoteStatusId: quoteSourceId,
      quoteApprovalPolicy: 'public',
      tags: importedTags,
      attachments: buildAttachments(sourceAttachments),
      poll:
        note.type === 'Question'
          ? {
              pollType: note.anyOf ? 'anyOf' : 'oneOf',
              choices: pollChoices.map((choice) => ({
                title: choice.name,
                totalVotes: choice.replies?.totalItems ?? 0
              })),
              endAt: pollEndAt ? Date.parse(pollEndAt) || published : published,
              hideTotals: false
            }
          : null,
      pinned: false,
      edits: []
    }
  }
}
