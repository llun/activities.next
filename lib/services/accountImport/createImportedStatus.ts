import { Database } from '@/lib/database/types'
import type {
  ImportedAttachment,
  ImportedEdit,
  ImportedStatusInput
} from '@/lib/services/accountImport/mappers/types'
import { resolveOwnedAttachments } from '@/lib/services/medias/attachmentMediaMetadata'
import type { Actor } from '@/lib/types/domain/actor'
import { getMention } from '@/lib/types/domain/actor'
import type { PostBoxAttachment } from '@/lib/types/domain/attachment'
import type { Status } from '@/lib/types/domain/status'
import { getLocalStatusId } from '@/lib/utils/activitypubId'

type StatusVersion = {
  text: string
  summary: string | null
  sensitive: boolean | null
  attachments: ImportedAttachment[] | null
  pollOptions: string[] | null
}

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

const resolveHistoryAttachments = async (
  database: Database,
  actor: Actor,
  attachments: ImportedAttachment[]
) => {
  const candidates: PostBoxAttachment[] = attachments
    .filter((attachment) => Boolean(attachment.mediaId))
    .map((attachment) => ({
      type: 'upload',
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
    metadata ? [{ ...attachment, ...metadata }] : []
  )
}

const appendStatusHistory = async ({
  database,
  actor,
  statusId,
  input,
  edits
}: {
  database: Database
  actor: Actor
  statusId: string
  input: ImportedStatusInput
  edits: ImportedEdit[]
}) => {
  if (edits.length === 0) return
  const ordered = [...edits].sort(
    (left, right) => left.supersededAt - right.supersededAt
  )
  const finalVersion: StatusVersion = {
    text: input.text,
    summary: input.summary,
    sensitive: input.sensitive,
    attachments: input.attachments,
    pollOptions: input.poll?.choices.map((choice) => choice.title) ?? null
  }
  const priorVersions: StatusVersion[] = ordered.map((edit) => ({
    text: edit.text,
    summary: edit.summary,
    sensitive: edit.sensitive,
    attachments: edit.attachments,
    pollOptions: edit.pollOptions
  }))
  const transitions = [...priorVersions.slice(1), finalVersion]

  for (const revision of transitions) {
    if (input.poll) {
      await database.updatePoll({
        statusId,
        text: revision.text,
        summary: revision.summary,
        choices: (revision.pollOptions ?? finalVersion.pollOptions ?? []).map(
          (title) => ({ title, totalVotes: 0 })
        ),
        endAt: input.published,
        pollType: input.poll.pollType,
        hideTotals: input.poll.hideTotals,
        resetVotes: true,
        ...(revision.sensitive === null
          ? null
          : { sensitive: revision.sensitive })
      })
    } else {
      await database.updateNote({
        statusId,
        text: revision.text,
        summary: revision.summary,
        ...(revision.sensitive === null
          ? null
          : { sensitive: revision.sensitive }),
        ...(revision.attachments === null
          ? null
          : {
              attachments: await resolveHistoryAttachments(
                database,
                actor,
                revision.attachments
              )
            })
      })
    }
    // Each update records the superseded row as a status_history revision. The
    // database API timestamps that transition at write time; the archive's
    // supersededAt value is retained for ordering but cannot be supplied to it.
  }
}

const makeInitialVersion = (input: ImportedStatusInput): StatusVersion => {
  const first = [...input.edits].sort(
    (left, right) => left.supersededAt - right.supersededAt
  )[0]
  return first
    ? {
        text: first.text,
        summary: first.summary,
        sensitive: first.sensitive,
        attachments: first.attachments,
        pollOptions: first.pollOptions
      }
    : {
        text: input.text,
        summary: input.summary,
        sensitive: input.sensitive,
        attachments: input.attachments,
        pollOptions: input.poll?.choices.map((choice) => choice.title) ?? null
      }
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

  const initial = makeInitialVersion(input)
  let reply = ''
  if (input.replyToStatusId) {
    const parent = await database.getStatus({ statusId: input.replyToStatusId })
    if (parent?.actorId === actor.id) reply = parent.id
  }
  const statusId = getLocalStatusId({
    actorId: actor.id,
    statusId: input.publicId
  })
  const initialAttachments = initial.attachments ?? input.attachments
  const initialPollChoices = input.poll
    ? (
        initial.pollOptions ?? input.poll.choices.map((choice) => choice.title)
      ).map((title) => ({ title, totalVotes: 0 }))
    : []
  const createParams = {
    id: statusId,
    url: `https://${actor.domain}/${getMention(actor)}/${input.publicId}`,
    publicId: input.publicId,
    actorId: actor.id,
    text: initial.text,
    summary: initial.summary,
    to: input.to,
    cc: input.cc,
    reply,
    sensitive: initial.sensitive ?? input.sensitive,
    language: input.language,
    quoteApprovalPolicy: input.quoteApprovalPolicy,
    createdAt: input.published
  }
  const result = input.poll
    ? await database.createPollWithResult({
        ...createParams,
        choices: initialPollChoices,
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
    initialAttachments,
    input.published
  )
  await appendStatusHistory({
    database,
    actor,
    statusId,
    input,
    edits: input.edits
  })

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
