import { indexHashtagSearchDocuments } from '@/lib/database/domains/search/hashtags'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import {
  type StatusSearchRow,
  indexStatusSearchDocument
} from '@/lib/database/domains/search/statuses'
import { selectHashtagTagsByStatusIds } from '@/lib/database/domains/status/hashtags'
import type {
  StatusHydration,
  UpdateNoteParams,
  UpdateNoteVisibilityParams,
  UpdatePollParams,
  UpdateStatusQuoteApprovalPolicyParams
} from '@/lib/database/domains/status/types'
import { resolveParentStatusIdByReply } from '@/lib/database/domains/status/writes'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { isPubliclyAddressed } from '@/lib/database/sql/utils/status'
import { Attachment, isFitnessAttachment } from '@/lib/types/domain/attachment'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { widensStatusAudience } from '@/lib/utils/widensStatusAudience'

// The status edits: a note's text and media, a note's audience, a poll's
// content, options and tallies, and a status's quote-approval policy. The edits
// that keep a revision write it to `status_history` in the same transaction as
// the change. updateNote and updateNoteVisibility read the status they edit
// through the injected hydration before their transaction (updatePoll and
// updateStatusQuoteApprovalPolicy read its row here), and each edit returns it
// re-read through that hydration after. The three that open a transaction
// reindex search after it.

const isReplaceableMediaAttachment = (
  attachment: Attachment
): attachment is Attachment & { mediaId: string } =>
  !isFitnessAttachment(attachment) &&
  attachment.mediaId !== null &&
  attachment.mediaId !== undefined

export const updateNote = async (
  db: Db,
  hydration: StatusHydration,
  {
    statusId,
    text,
    summary,
    attachments,
    sensitive,
    language
  }: UpdateNoteParams
): Promise<Status | null> => {
  const status = await hydration.getStatus({ statusId })
  if (!status) return null

  if (status.type !== StatusType.enum.Note) return null

  const previousData = {
    text: status.text,
    summary: status.summary,
    // Snapshot the state each /statuses/:id/history revision needs; rows
    // without these keys (written before snapshotting) read back as null and
    // fall back to the status's current values in the serializer.
    sensitive: status.sensitive ?? false,
    attachments: status.attachments,
    pollOptions: null
  }
  const currentTime = new Date()
  const content = {
    url: status.url,
    text,
    summary,
    // Preserve the existing flags unless the caller explicitly overrides them.
    sensitive: sensitive === undefined ? status.sensitive : sensitive,
    language: language === undefined ? status.language : language
  }
  const statusContent = JSON.stringify(content)
  const searchStatus: StatusSearchRow = {
    id: status.id,
    actorId: status.actorId,
    type: status.type,
    content: statusContent,
    createdAt: status.createdAt
  }
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('status_history')
      .values({
        statusId: status.id,
        data: JSON.stringify(previousData),
        createdAt: new Date(status.createdAt),
        updatedAt: currentTime
      })
      .execute()
    await trx
      .updateTable('statuses')
      .set({
        url: status.url || null,
        urlHash: status.url ? getHashFromString(status.url) : null,
        content: statusContent,
        updatedAt: currentTime
      })
      .where('id', '=', status.id)
      .execute()

    if (attachments === undefined) return

    const incomingMediaIds = new Set(
      attachments.map((attachment) => attachment.id)
    )
    const existingReplaceableAttachments = status.attachments.filter(
      isReplaceableMediaAttachment
    )
    const replaceableAttachmentIds = status.attachments
      .filter(
        (attachment) =>
          isReplaceableMediaAttachment(attachment) &&
          !incomingMediaIds.has(attachment.mediaId)
      )
      .map((attachment) => attachment.id)
    if (replaceableAttachmentIds.length > 0) {
      await trx
        .deleteFrom('attachments')
        .where('statusId', '=', status.id)
        .where('actorId', '=', status.actorId)
        .where('id', 'in', replaceableAttachmentIds)
        .execute()
    }

    const existingMediaIds = new Set(
      existingReplaceableAttachments.map((attachment) => attachment.mediaId)
    )
    // Every new row is parsed before the first is written.
    const newAttachments = attachments
      .filter((attachment) => !existingMediaIds.has(attachment.id))
      .map((attachment, index) => {
        const attachmentCreatedAt = new Date(currentTime.getTime() + index)
        const data = Attachment.parse({
          id: crypto.randomUUID(),
          actorId: status.actorId,
          statusId: status.id,
          type: 'Document',
          mediaType: attachment.mediaType,
          url: attachment.url,
          width: attachment.width,
          height: attachment.height,
          name: attachment.name ?? '',
          mediaId: attachment.id,
          blurhash: attachment.blurhash,
          focus: attachment.focus,
          thumbnailUrl: attachment.thumbnailUrl,
          createdAt: attachmentCreatedAt.getTime(),
          updatedAt: attachmentCreatedAt.getTime()
        })
        return { data, attachmentCreatedAt }
      })

    for (const { data, attachmentCreatedAt } of newAttachments) {
      // `focus` is one object on the parsed row and two columns in the
      // table, so the insert is written out column by column the way
      // `createAttachment` does it rather than spreading `data`.
      await trx
        .insertInto('attachments')
        .values({
          id: data.id,
          actorId: data.actorId,
          statusId: data.statusId,
          type: data.type,
          mediaType: data.mediaType,
          url: data.url,
          width: data.width,
          height: data.height,
          name: data.name,
          mediaId: data.mediaId,
          blurhash: data.blurhash ?? null,
          focusX: data.focus?.x ?? null,
          focusY: data.focus?.y ?? null,
          thumbnailUrl: data.thumbnailUrl ?? null,
          createdAt: attachmentCreatedAt,
          updatedAt: attachmentCreatedAt
        })
        .execute()
    }

    // Attachments kept across the edit refresh every field they copied
    // from the media row — alt text, BlurHash, focal point, thumbnail and
    // the file itself (url, size, type): the attachment row snapshots them
    // at attach time, so a media_attributes edit must re-copy them or the
    // status keeps serving the stale value. Focus is the one a client can
    // change on a posted status (Mastodon's focal-point editor); the file
    // changes when a photo edit is applied to the posts that use it. Only
    // rows that actually differ are rewritten, so an edit that leaves the
    // media untouched preserves the existing row (createdAt/updatedAt)
    // unchanged.
    const existingSnapshotByMediaId = new Map(
      existingReplaceableAttachments.map((attachment) => [
        attachment.mediaId,
        attachment
      ])
    )
    const isSameFocus = (
      left: { x: number; y: number } | null | undefined,
      right: { x: number; y: number } | null | undefined
    ) =>
      (left?.x ?? null) === (right?.x ?? null) &&
      (left?.y ?? null) === (right?.y ?? null)
    const keptAttachments = attachments.filter((attachment) => {
      if (!existingMediaIds.has(attachment.id)) return false
      const existing = existingSnapshotByMediaId.get(attachment.id)
      if (!existing) return false
      return (
        attachment.url !== existing.url ||
        attachment.mediaType !== existing.mediaType ||
        attachment.width !== (existing.width ?? null) ||
        attachment.height !== (existing.height ?? null) ||
        (attachment.name ?? '') !== (existing.name ?? '') ||
        (attachment.blurhash ?? null) !== (existing.blurhash ?? null) ||
        (attachment.thumbnailUrl ?? null) !== (existing.thumbnailUrl ?? null) ||
        !isSameFocus(attachment.focus, existing.focus)
      )
    })
    // `attachments.mediaId` is an `integer` column on PostgreSQL, so a
    // malformed id here would error rather than miss. Safe without its own
    // coercion: every `attachment.id` in `keptAttachments` has already
    // resolved through `getMediaByIdForAccount`, which rejects anything
    // that is not a real row id (see `toMediaRowId`).
    for (const attachment of keptAttachments) {
      await trx
        .updateTable('attachments')
        .set({
          url: attachment.url,
          mediaType: attachment.mediaType,
          width: attachment.width,
          height: attachment.height,
          name: attachment.name ?? '',
          blurhash: attachment.blurhash,
          focusX: attachment.focus?.x ?? null,
          focusY: attachment.focus?.y ?? null,
          thumbnailUrl: attachment.thumbnailUrl,
          updatedAt: currentTime
        })
        .where('statusId', '=', status.id)
        .where('mediaId', '=', attachment.id)
        .execute()
    }
  })
  await indexStatusSearchDocument(db, { status: searchStatus })
  return hydration.getStatus({ statusId })
}

export const updateNoteVisibility = async (
  db: Db,
  hydration: StatusHydration,
  { statusId, to, cc }: UpdateNoteVisibilityParams
): Promise<Status | null> => {
  const status = await hydration.getStatus({ statusId })
  if (!status) return null
  if (status.type !== StatusType.enum.Note) return null

  let affectedHashtags: string[] = []
  const currentTime = new Date()
  const searchStatus: StatusSearchRow = {
    id: status.id,
    actorId: status.actorId,
    type: status.type,
    content: JSON.stringify({
      url: status.url,
      text: status.text,
      summary: status.summary
    }),
    createdAt: status.createdAt
  }
  // Prior revisions were written for the old audience; see
  // widensStatusAudience for why a widening change drops them.
  const widensAudience = widensStatusAudience(status, { to, cc })
  await inTransaction(db, async (trx) => {
    if (widensAudience) {
      await trx
        .deleteFrom('status_history')
        .where('statusId', '=', status.id)
        .execute()
    }
    await trx
      .deleteFrom('recipients')
      .where('statusId', '=', status.id)
      .execute()
    await trx
      .deleteFrom('timelines')
      .where('statusId', '=', status.id)
      .execute()
    for (const [type, actorIds] of [
      ['to', to],
      ['cc', cc]
    ] as const) {
      for (const actorId of actorIds) {
        await trx
          .insertInto('recipients')
          .values({
            id: crypto.randomUUID(),
            statusId: status.id,
            actorId,
            type,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .execute()
      }
    }
    const hashtagTags = await selectHashtagTagsByStatusIds(trx, [status.id])
    affectedHashtags = hashtagTags.map((tag) => tag.name)

    // The reply and hashtag counters count only publicly addressed statuses,
    // so a visibility change that crosses that line moves them too —
    // otherwise a later delete would decrement a count this status never
    // contributed to, or leave behind one it no longer should.
    const wasPublic = isPubliclyAddressed(status)
    if (wasPublic !== isPubliclyAddressed({ to, cc })) {
      const adjust = wasPublic ? decreaseCounterValue : increaseCounterValue
      const parentStatusId = await resolveParentStatusIdByReply(
        trx,
        status.reply
      )
      if (parentStatusId) {
        await adjust(trx, CounterKey.totalReply(parentStatusId), 1, currentTime)
      }
      // Per tag row, exactly as the create and delete paths count them.
      for (const tag of hashtagTags) {
        const tagName = normalizeHashtagSearchName(tag.name)
        await adjust(trx, CounterKey.totalHashtag(tagName), 1, currentTime)
      }
    }
  })
  if (affectedHashtags.length > 0) {
    await indexHashtagSearchDocuments(db, { hashtags: affectedHashtags })
  }
  await indexStatusSearchDocument(db, { status: searchStatus })
  return hydration.getStatus({ statusId })
}

// The `statuses` row of `statusId`, or undefined.
const selectStatusRow = (db: Db, statusId: string) =>
  db
    .selectFrom('statuses')
    .selectAll()
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()

export const updatePoll = async (
  db: Db,
  hydration: StatusHydration,
  {
    statusId,
    text,
    summary,
    choices,
    sensitive,
    language,
    endAt,
    pollType,
    hideTotals,
    resetVotes = false
  }: UpdatePollParams
): Promise<Status | null> => {
  const existingStatus = await selectStatusRow(db, statusId)
  if (!existingStatus) return null
  const currentTime = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = getCompatibleJSON<any>(existingStatus.content)
  const nextText = text ?? data.text
  // undefined = keep the existing summary; a provided value (including an
  // empty/whitespace string) normalizes to null when blank, matching
  // createPoll's `summary?.trim() || null` so a cleared CW never persists as
  // '' (which would flip contentChanged and record a spurious edit revision).
  const nextSummary =
    summary === undefined ? data.summary : summary?.trim() || null
  const content = {
    url: data.url,
    text: nextText,
    summary: nextSummary,
    sensitive: sensitive === undefined ? (data.sensitive ?? false) : sensitive,
    language: language === undefined ? (data.language ?? null) : language,
    endAt: endAt ?? data.endAt,
    pollType: pollType ?? data.pollType,
    hideTotals:
      hideTotals === undefined ? (data.hideTotals ?? false) : hideTotals
  }
  const statusContent = JSON.stringify(content)
  const searchStatus: StatusSearchRow = {
    id: existingStatus.id,
    actorId: existingStatus.actorId as string,
    type: existingStatus.type as string,
    content: statusContent,
    // new Date(null), Knex's read of a NULL createdAt, was epoch 0 too.
    createdAt: existingStatus.createdAt ?? 0
  }

  // Any user-visible change records an edit revision; a tally-only refresh
  // (federated vote sync) must not.
  const contentChanged =
    nextText !== data.text ||
    // Treat an empty-string summary the same as null: a poll created with the
    // createPoll default ('') edited with a blank spoiler normalizes to null,
    // which is not a user-visible change and must not record a revision.
    (nextSummary || null) !== (data.summary || null) ||
    content.sensitive !== (data.sensitive ?? false) ||
    content.language !== (data.language ?? null) ||
    content.endAt !== data.endAt ||
    content.pollType !== data.pollType ||
    content.hideTotals !== (data.hideTotals ?? false) ||
    resetVotes

  await inTransaction(db, async (trx) => {
    if (contentChanged) {
      const previousChoices = await trx
        .selectFrom('poll_choices')
        .select('title')
        .where('statusId', '=', statusId)
        .orderBy('choiceId', 'asc')
        .execute()
      const previousData = {
        text: data.text,
        summary: data.summary,
        sensitive: data.sensitive ?? false,
        attachments: [],
        pollOptions: previousChoices.map((choice) => choice.title)
      }
      await trx
        .insertInto('status_history')
        .values({
          statusId,
          data: JSON.stringify(previousData),
          createdAt: new Date(existingStatus.createdAt ?? 0),
          updatedAt: currentTime
        })
        .execute()
      await trx
        .updateTable('statuses')
        .set({
          url: data.url || null,
          urlHash: data.url ? getHashFromString(data.url) : null,
          content: statusContent,
          updatedAt: currentTime
        })
        .where('id', '=', statusId)
        .execute()
    }
    if (resetVotes) {
      // Mastodon resets a poll whose options changed: all recorded votes are
      // removed and the replacement options start from zero. Sequential
      // inserts keep choiceId order deterministic for hydration.
      await trx
        .deleteFrom('poll_answers')
        .where('statusId', '=', statusId)
        .execute()
      await trx
        .deleteFrom('poll_voters')
        .where('statusId', '=', statusId)
        .execute()
      await trx
        .deleteFrom('poll_choices')
        .where('statusId', '=', statusId)
        .execute()
      for (const choice of choices) {
        await trx
          .insertInto('poll_choices')
          .values({
            statusId,
            title: choice.title,
            totalVotes: 0,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .execute()
      }
      return
    }
    for (const choice of choices) {
      await trx
        .updateTable('poll_choices')
        .set({ totalVotes: choice.totalVotes, updatedAt: currentTime })
        .where('statusId', '=', statusId)
        .where('title', '=', choice.title)
        .execute()
    }
  })
  await indexStatusSearchDocument(db, { status: searchStatus })
  return hydration.getStatus({ statusId })
}

export const updateStatusQuoteApprovalPolicy = async (
  db: Db,
  hydration: StatusHydration,
  { statusId, quoteApprovalPolicy }: UpdateStatusQuoteApprovalPolicyParams
): Promise<Status | null> => {
  const existingStatus = await selectStatusRow(db, statusId)
  if (!existingStatus) return null

  // Rewrite only the quote-approval policy inside the content blob, preserving
  // every other key. Deliberately NOT a status edit: no status_history row and
  // no updatedAt bump, so `edited_at` never flips (Mastodon treats an
  // interaction-policy change as a non-edit).
  const data = getCompatibleJSON<Record<string, unknown> | null>(
    existingStatus.content
  )
  const content = { ...data, quoteApprovalPolicy }
  await db
    .updateTable('statuses')
    .set({ content: JSON.stringify(content) })
    .where('id', '=', statusId)
    .execute()

  return hydration.getStatus({ statusId })
}
