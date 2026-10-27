import {
  buildAttachments,
  buildEdits,
  buildRecipients,
  buildTags,
  deterministicPublicId,
  parsePublished,
  replyReference
} from '@/lib/services/accountImport/mappers/shared'
import type {
  ImportMapperContext,
  ImportMapperResult
} from '@/lib/services/accountImport/mappers/types'
import { ownStatusRecordSchema } from '@/lib/services/accountImport/schemas'

export const mapOwnStatus = (
  row: unknown,
  context: ImportMapperContext
): ImportMapperResult => {
  const parsed = ownStatusRecordSchema.safeParse(row)
  if (!parsed.success) return { ok: false, reason: 'invalid' }

  const status = parsed.data
  if (status.type === 'Announce') return { ok: false, reason: 'boost' }

  const published = parsePublished(status.createdAt, context.nowMs)
  if (published === null) return { ok: false, reason: 'bad-date' }

  const parentId = status.inReplyTo
  const reply = replyReference(parentId, context)
  if (!reply.ok) return reply

  const tags = buildTags(
    status.tags.map((tag) => ({
      type: tag.type,
      name: tag.name,
      value: tag.value
    }))
  )
  const mentions = tags
    .filter((tag) => tag.type === 'mention')
    .map((tag) => ({
      type: 'Mention' as const,
      href: tag.value,
      name: tag.name
    }))
  const recipients = buildRecipients(context.actor, mentions, status.visibility)
  const quoteSourceId =
    status.quote && context.ownStatusIds.has(status.quote.quotedStatusId)
      ? status.quote.quotedStatusId
      : null

  return {
    ok: true,
    input: {
      sourceId: status.id,
      sourceUrl: status.url,
      publicId: deterministicPublicId(status.id, published),
      published,
      visibility: status.visibility,
      ...recipients,
      text: status.text,
      summary: status.summary,
      sensitive: status.sensitive,
      language: status.language,
      replyToStatusId: reply.replyToStatusId,
      externalReplyUri: reply.externalReplyUri,
      quoteSourceId,
      quoteStatusId: quoteSourceId,
      quoteApprovalPolicy: status.quoteApprovalPolicy,
      tags,
      attachments: buildAttachments(status.attachments),
      poll:
        status.type === 'Poll'
          ? {
              pollType: status.poll.pollType,
              choices: status.poll.choices,
              endAt: Date.parse(status.poll.endAt) || published,
              hideTotals: status.poll.hideTotals
            }
          : null,
      pinned: status.pinned,
      edits: buildEdits(status.edits)
    }
  }
}
