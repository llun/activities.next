import type { StatusEditRevision } from '@/lib/types/database/operations'
import { getDocumentFromAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getVisibility } from '@/lib/utils/getVisibility'

import { buildStatusHistoryEntry } from './actorArchive'

type UrlToArchivePath = (url: string) => string

/**
 * One line of `statuses.jsonl`: everything the database knows about a status of
 * the exporting actor that the Mastodon-shaped `outbox.json` has no place for
 * (the exact visibility, quote policy, poll state, pin, edit history, and the
 * ids of what it replies to or quotes).
 */
export const buildStatusRecord = ({
  status,
  pinned,
  history,
  urlToArchivePath
}: {
  status: Status
  pinned: boolean
  history: StatusEditRevision[] | null
  urlToArchivePath: UrlToArchivePath
}): Record<string, unknown> => {
  const base = {
    id: status.id,
    publicId: status.publicId ?? null,
    type: status.type,
    actorId: status.actorId,
    visibility: getVisibility(
      status.to,
      status.cc,
      status.actor?.followersUrl ?? null
    ),
    to: status.to,
    cc: status.cc,
    createdAt: getISOTimeUTC(status.createdAt),
    updatedAt: getISOTimeUTC(status.updatedAt)
  }

  if (status.type === StatusType.enum.Announce) {
    return { ...base, originalStatusId: status.originalStatus.id }
  }

  return {
    ...base,
    url: status.url,
    inReplyTo: status.reply || null,
    text: status.text,
    summary: status.summary ?? null,
    sensitive: status.sensitive ?? false,
    language: status.language ?? null,
    applicationName: status.applicationName ?? null,
    applicationWebsite: status.applicationWebsite ?? null,
    pinned,
    quote: status.quote ?? null,
    quoteApprovalPolicy: status.quoteApprovalPolicy ?? 'public',
    tags: status.tags,
    attachments: status.attachments.map((attachment) => ({
      ...getDocumentFromAttachment(attachment),
      mediaId: attachment.mediaId ?? null,
      url: urlToArchivePath(attachment.url)
    })),
    poll:
      status.type === StatusType.enum.Poll
        ? {
            pollType: status.pollType,
            endAt: getISOTimeUTC(status.endAt),
            hideTotals: status.hideTotals ?? false,
            votersCount: status.votersCount ?? null,
            choices: status.choices.map((choice) => ({
              title: choice.title,
              totalVotes: choice.totalVotes
            }))
          }
        : null,
    edits: history
      ? history.map((revision) =>
          buildStatusHistoryEntry(revision, urlToArchivePath)
        )
      : []
  }
}
