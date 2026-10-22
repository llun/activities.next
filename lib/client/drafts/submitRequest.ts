// One source for "what a draft sends and under which fingerprint". The
// composers (PostBox, StatusReplyBox) and the send queue all build their
// Idempotency-Key fingerprints here, so a composer retry and a queued send of
// the same content reuse the same key and cannot duplicate a post.
//
// Type-only imports: this module is safe to load from the composer bundle.
import type { CreateNoteParams, CreatePollParams } from '@/lib/client/statuses'
import type { Duration } from '@/lib/services/statuses/pollDurations'
import type { PostBoxAttachment } from '@/lib/types/domain/attachment'
import type { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

import type { DraftAttachment, DraftRecord } from './types'

// PR 2 drafts already hold fingerprints in these exact shapes: keep every key
// and its order (insertion order is the serialization order). The golden
// strings in submitRequest.test.ts pin them.

export const postBoxNoteFingerprint = (f: {
  message: string
  contentWarning: string
  replyStatusId?: string | null
  quotedStatusId?: string | null
  attachmentIds: string[]
  fitnessFileId?: string | null
  visibility: MastodonVisibility
  quoteApprovalPolicy: QuoteApprovalPolicy
}): string =>
  JSON.stringify({
    type: 'note',
    message: f.message,
    contentWarning: f.contentWarning,
    replyStatusId: f.replyStatusId ?? null,
    quotedStatusId: f.quotedStatusId ?? null,
    attachmentIds: f.attachmentIds,
    fitnessFileId: f.fitnessFileId ?? null,
    visibility: f.visibility,
    quoteApprovalPolicy: f.quoteApprovalPolicy
  })

export const postBoxPollFingerprint = (f: {
  message: string
  contentWarning: string
  choices: string[]
  durationInSeconds: Duration
  pollType: 'oneOf' | 'anyOf'
  replyStatusId?: string | null
  visibility: MastodonVisibility
}): string =>
  JSON.stringify({
    type: 'poll',
    message: f.message,
    contentWarning: f.contentWarning,
    choices: f.choices,
    durationInSeconds: f.durationInSeconds,
    pollType: f.pollType,
    replyStatusId: f.replyStatusId ?? null,
    visibility: f.visibility
  })

export const replyBoxFingerprint = (f: {
  message: string
  contentWarning?: string | null
  inReplyToId: string
  visibility: MastodonVisibility
  language?: string | null
  attachmentIds: string[]
}): string =>
  JSON.stringify({
    message: f.message,
    contentWarning: f.contentWarning ?? null,
    inReplyToId: f.inReplyToId,
    visibility: f.visibility,
    language: f.language ?? null,
    attachmentIds: f.attachmentIds
  })

/** The uploaded (`mediaId`) branch of a draft attachment as a PostBox attachment. */
export const uploadedDraftAttachment = (
  item: DraftAttachment & { mediaId: string }
): PostBoxAttachment => ({
  type: 'upload',
  id: item.mediaId,
  mediaType: item.mediaType,
  url: item.url ?? '',
  posterUrl: item.posterUrl,
  width: item.width ?? 0,
  height: item.height ?? 0,
  name: item.description
})

export type SubmitRequest =
  | {
      kind: 'note'
      params: Omit<CreateNoteParams, 'idempotencyKey'>
      fingerprint: string
    }
  | {
      kind: 'poll'
      params: Omit<CreatePollParams, 'idempotencyKey'>
      fingerprint: string
    }

/** Throws if an attachment has no mediaId or the fitness file no fitnessFileId (upload first). */
export const buildSubmitRequest = (draft: DraftRecord): SubmitRequest => {
  const contentWarningShown = draft.contentWarningVisible
  const replyStatusId = draft.replyTo?.id

  if (draft.composer === 'post-box' && draft.poll) {
    const contentWarning = contentWarningShown ? draft.contentWarning : ''
    const { choices, durationInSeconds, pollType } = draft.poll
    return {
      kind: 'poll',
      params: {
        message: draft.text,
        contentWarning,
        choices,
        durationInSeconds,
        pollType,
        replyStatus: draft.replyTo,
        visibility: draft.visibility
      },
      fingerprint: postBoxPollFingerprint({
        message: draft.text,
        contentWarning,
        choices,
        durationInSeconds,
        pollType,
        replyStatusId,
        visibility: draft.visibility
      })
    }
  }

  const attachments = draft.attachments.map((item) => {
    if (!item.mediaId) {
      throw new Error(`Attachment ${item.fileName} has not been uploaded`)
    }
    return uploadedDraftAttachment({ ...item, mediaId: item.mediaId })
  })
  const attachmentIds = attachments.map((attachment) => attachment.id)

  if (draft.composer === 'reply-box') {
    if (!draft.replyTo) throw new Error('A reply draft has no post to reply to')
    const contentWarning = contentWarningShown
      ? draft.contentWarning
      : undefined
    return {
      kind: 'note',
      params: {
        message: draft.text,
        contentWarning,
        replyStatus: draft.replyTo,
        inReplyToId: draft.replyTo.id,
        visibility: draft.visibility,
        language: draft.language,
        attachments
      },
      fingerprint: replyBoxFingerprint({
        message: draft.text,
        contentWarning,
        inReplyToId: draft.replyTo.id,
        visibility: draft.visibility,
        language: draft.language,
        attachmentIds
      })
    }
  }

  const fitness = draft.fitnessFile
  if (fitness && !fitness.fitnessFileId) {
    throw new Error(`Fitness file ${fitness.fileName} has not been uploaded`)
  }
  const fitnessFileId = fitness?.fitnessFileId
  const contentWarning = contentWarningShown ? draft.contentWarning : ''
  return {
    kind: 'note',
    params: {
      message: draft.text,
      contentWarning,
      replyStatus: draft.replyTo,
      quotedStatus: draft.quoteOf,
      attachments,
      fitnessFileId,
      visibility: draft.visibility,
      quoteApprovalPolicy: draft.quoteApprovalPolicy
    },
    fingerprint: postBoxNoteFingerprint({
      message: draft.text,
      contentWarning,
      replyStatusId,
      quotedStatusId: draft.quoteOf?.id,
      attachmentIds,
      fitnessFileId,
      visibility: draft.visibility,
      quoteApprovalPolicy: draft.quoteApprovalPolicy
    })
  }
}
