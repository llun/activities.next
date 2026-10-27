import type { AppendStatusHistoryRevision } from '@/lib/database/domains/status/types'
import { Database } from '@/lib/database/types'
import type {
  ImportedAttachment,
  ImportedEdit,
  ImportedStatusInput
} from '@/lib/services/accountImport/mappers/types'
import { resolveOwnedAttachments } from '@/lib/services/medias/attachmentMediaMetadata'
import type { Actor } from '@/lib/types/domain/actor'
import { getMention } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import type { Status } from '@/lib/types/domain/status'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { generatePublicId } from '@/lib/utils/publicId'

const createStatusAttachment = async ({
  database,
  actor,
  statusId,
  attachment,
  createdAt
}: {
  database: Database
  actor: Actor
  statusId: string
  attachment: ImportedAttachment
  createdAt: number
}) => {
  if (!attachment.mediaId) return
  const resolved = await resolveOwnedAttachments({
    database,
    currentActor: actor,
    attachments: [
      {
        type: 'upload',
        id: attachment.mediaId,
        mediaType: attachment.mediaType,
        url: attachment.sourceUrl,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        ...(attachment.name ? { name: attachment.name } : null)
      }
    ]
  })
  const { attachment: owned, metadata } = resolved[0]
  if (!metadata) return
  await database.createAttachment({
    actorId: actor.id,
    statusId,
    createdAt,
    mediaType: owned.mediaType,
    url: owned.url,
    width: owned.width,
    height: owned.height,
    name: owned.name,
    mediaId: String(owned.id),
    ...metadata
  })
}

// One archived revision's attachments, as the hydrated Attachment rows the
// live status's own edit history snapshots: the owned media's current url and
// metadata, dated at the archived supersede time. No attachment rows are
// written — a superseded version's media lives on only in its snapshot.
const historyAttachments = async (
  database: Database,
  actor: Actor,
  statusId: string,
  attachments: ImportedAttachment[],
  supersededAt: number
) => {
  const candidates = attachments
    .filter((attachment) => Boolean(attachment.mediaId))
    .map((attachment) => ({
      type: 'upload' as const,
      id: attachment.mediaId as string,
      mediaType: attachment.mediaType,
      url: attachment.sourceUrl,
      width: attachment.width ?? 0,
      height: attachment.height ?? 0,
      ...(attachment.name ? { name: attachment.name } : null)
    }))
  const owned = await resolveOwnedAttachments({
    database,
    currentActor: actor,
    attachments: candidates
  })
  return owned.flatMap(({ attachment, metadata }) =>
    metadata
      ? [
          Attachment.parse({
            id: crypto.randomUUID(),
            actorId: actor.id,
            statusId,
            type: 'Document',
            mediaType: attachment.mediaType,
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            name: attachment.name ?? '',
            mediaId: attachment.id,
            blurhash: metadata.blurhash,
            focus: metadata.focus,
            thumbnailUrl: metadata.thumbnailUrl,
            createdAt: supersededAt,
            updatedAt: supersededAt
          })
        ]
      : []
  )
}

// Records the archived edits as status_history revisions with their original
// supersede times, through the database's own appendStatusHistory: replaying
// them through updateNote/updatePoll would stamp every transition at import
// time and lose the archived edit times.
const appendStatusHistory = async (
  database: Database,
  actor: Actor,
  statusId: string,
  edits: ImportedEdit[]
) => {
  if (edits.length === 0) return
  const revisions: AppendStatusHistoryRevision[] = []
  for (const edit of [...edits].sort(
    (left, right) => left.supersededAt - right.supersededAt
  )) {
    revisions.push({
      text: edit.text,
      summary: edit.summary,
      sensitive: edit.sensitive,
      attachments: edit.attachments
        ? await historyAttachments(
            database,
            actor,
            statusId,
            edit.attachments,
            edit.supersededAt
          )
        : null,
      pollOptions: edit.pollOptions,
      supersededAt: edit.supersededAt
    })
  }
  await database.appendStatusHistory({ statusId, revisions })
}

const addTags = async (
  database: Database,
  statusId: string,
  input: ImportedStatusInput
) => {
  const existingEmojis = await database.getCustomEmojis()
  const emojiByShortcode = new Map(
    existingEmojis.map((emoji) => [emoji.shortcode.toLowerCase(), emoji])
  )
  const seen = new Set<string>()
  const writes = input.tags.flatMap((tag) => {
    if (tag.type === 'emoji') {
      const shortcode = tag.name.replace(/^:|:$/g, '').toLowerCase()
      const emoji = emojiByShortcode.get(shortcode)
      if (!emoji) return []
      const key = `emoji:${emoji.shortcode.toLowerCase()}`
      if (seen.has(key)) return []
      seen.add(key)
      return [
        database.createTag({
          statusId,
          type: 'emoji',
          name: `:${emoji.shortcode}:`,
          value: emoji.url
        })
      ]
    }
    const key = `${tag.type}:${tag.name.toLowerCase()}:${tag.value}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      database.createTag({
        statusId,
        type: tag.type,
        name: tag.name,
        value: tag.value
      })
    ]
  })
  await Promise.all(writes)
}

const addAttachments = async (
  database: Database,
  actor: Actor,
  statusId: string,
  attachments: ImportedAttachment[],
  published: number
) => {
  for (const [index, attachment] of attachments.entries()) {
    await createStatusAttachment({
      database,
      actor,
      statusId,
      attachment,
      createdAt: published + index
    })
  }
}

export const createImportedStatus = async (
  database: Database,
  actor: Actor,
  input: ImportedStatusInput
): Promise<Status> => {
  const existing = await database.getStatusFromPublicId({
    publicId: input.publicId,
    currentActorId: actor.id
  })
  if (existing?.actorId === actor.id) return existing
  // The deterministic publicId already belongs to another actor's status
  // (a pre-fix import or a crafted archive that pre-empted it): never insert
  // with it and never return that row. A fresh random UUIDv7 keeps the write
  // quiet and local; the importing actor's own re-run still finds its own row
  // through the deterministic id whenever no other actor owns it.
  const publicId = existing ? generatePublicId() : input.publicId

  let reply = ''
  if (input.replyToStatusId) {
    const parent = await database.getStatus({ statusId: input.replyToStatusId })
    if (parent?.actorId === actor.id) reply = parent.id
  }
  const statusId = getLocalStatusId({
    actorId: actor.id,
    statusId: publicId
  })
  const createParams = {
    id: statusId,
    url: `https://${actor.domain}/${getMention(actor)}/${publicId}`,
    publicId,
    actorId: actor.id,
    text: input.text,
    summary: input.summary,
    to: input.to,
    cc: input.cc,
    reply,
    sensitive: input.sensitive,
    language: input.language,
    quoteApprovalPolicy: input.quoteApprovalPolicy,
    createdAt: input.published
  }
  const result = input.poll
    ? await database.createPollWithResult({
        ...createParams,
        choices: input.poll.choices,
        endAt: input.published,
        pollType: input.poll.pollType,
        hideTotals: input.poll.hideTotals
      })
    : await database.createNoteWithResult(createParams)
  if (!result.isNew) return result.status

  await addTags(database, statusId, input)
  await addAttachments(
    database,
    actor,
    statusId,
    input.attachments,
    input.published
  )
  await appendStatusHistory(database, actor, statusId, input.edits)

  if (input.pinned) await database.pinStatus({ actorId: actor.id, statusId })

  if (input.quoteStatusId) {
    const quoted = await database.getStatus({ statusId: input.quoteStatusId })
    if (quoted?.actorId === actor.id) {
      await database.createStatusQuote({
        statusId,
        quotedStatusId: quoted.id,
        state: 'accepted'
      })
    }
  }

  return (await database.getStatus({ statusId })) ?? result.status
}
