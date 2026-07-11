import identity from 'lodash/identity'
import { z } from 'zod'

import { AnnounceStatus } from '@/lib/activities/announceStatus'
import {
  getContent,
  getLanguage,
  getReply,
  getSummary
} from '@/lib/activities/note'
import { MAX_FEDERATION_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import type { Announce as ActivityPubAnnounce } from '@/lib/types/activitypub/activities'
import { Document } from '@/lib/types/activitypub/objects'
import {
  ENTITY_TYPE_QUESTION,
  Note,
  Question
} from '@/lib/types/activitypub/objects'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Attachment,
  getDocumentFromAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
import { PollChoice } from '@/lib/types/domain/pollChoice'
import { Tag, getEmojiFromTag, getMentionFromTag } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const StatusType = z.enum(['Note', 'Announce', 'Poll'])
export type StatusType = z.infer<typeof StatusType>

export const StatusFitnessFile = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.enum(['fit', 'gpx', 'tcx']),
  mimeType: z.string(),
  bytes: z.number(),
  url: z.string(),
  description: z.string().optional(),
  processingStatus: z
    .enum(['pending', 'processing', 'completed', 'failed'])
    .optional(),
  // True when a `processing` file has been stranded long enough that its worker
  // must have died mid-job; signals clients to offer a retry. Computed
  // server-side from the file's `updatedAt`.
  processingStuck: z.boolean().optional(),
  totalDistanceMeters: z.number().optional(),
  totalDurationSeconds: z.number().optional(),
  elevationGainMeters: z.number().optional(),
  activityType: z.string().optional(),
  hasMapData: z.boolean().optional(),
  deviceName: z.string().optional(),
  deviceManufacturer: z.string().optional(),
  sourceUrl: z.string().optional()
})
export type StatusFitnessFile = z.infer<typeof StatusFitnessFile>

export const Edited = z.object({
  text: z.string(),
  summary: z.string().nullable().optional(),
  createdAt: z.number()
})

export type Edited = z.infer<typeof Edited>

const StatusBase = z.object({
  id: z.string(),
  actorId: z.string(),
  actor: ActorProfile.nullable(),

  to: z.string().array(),
  cc: z.string().array(),

  edits: Edited.array(),

  isLocalActor: z.boolean(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export const StatusNote = StatusBase.extend({
  type: z.literal(StatusType.enum.Note),
  url: z.string(),
  text: z.string(),
  summary: z.string().nullable().optional(),
  // Explicit "mark media as sensitive" flag. Independent of `summary`: a status
  // can be sensitive without a content warning, and Mastodon also forces
  // sensitive=true whenever a spoiler/summary is present (applied in the
  // Mastodon serializer, not here). Optional so existing status literals and
  // remote notes that predate the field remain valid; treated as false/null.
  sensitive: z.boolean().optional(),
  // ISO 639 Part 1 two-letter language code, or null when unknown.
  language: z.string().nullable().optional(),
  // Content-detected language (ISO 639-1), stored separately from the
  // declared `language` above. Populated by lib/services/language-detection
  // and used to widen the Translate gate when the two disagree (e.g. a post
  // declared "en" whose content is actually Thai). Null/absent when
  // detection hasn't run yet or was inconclusive.
  detectedLanguage: z.string().nullable().optional(),
  // The registered OAuth client (Mastodon "application") that authored the
  // status, when it was created via an app token. Null/absent for statuses
  // created through the web session. Optional so existing status literals and
  // remote notes that predate the fields remain valid.
  applicationName: z.string().nullable().optional(),
  applicationWebsite: z.string().nullable().optional(),
  reply: z.string(),
  replies: z.looseObject(StatusBase.shape).array(),

  actorAnnounceStatusId: z.string().nullable(),
  isActorLiked: z.boolean(),
  isActorBookmarked: z.boolean(),
  totalLikes: z.number(),
  totalShares: z.number().default(0),

  attachments: Attachment.array(),
  tags: Tag.array(),
  fitness: StatusFitnessFile.optional()
})
export type StatusNote = z.infer<typeof StatusNote>

export const StatusPoll = StatusNote.extend({
  type: z.literal(StatusType.enum.Poll),
  choices: PollChoice.array(),
  endAt: z.number(),
  pollType: z.enum(['oneOf', 'anyOf']).default('oneOf'),
  // Mastodon poll[hide_totals]: per-option tallies stay hidden until the poll
  // expires. Optional so existing rows/literals default to false.
  hideTotals: z.boolean().optional(),
  votersCount: z.number().optional(),
  voted: z.boolean().optional(),
  ownVotes: z.array(z.number()).optional()
})
export type StatusPoll = z.infer<typeof StatusPoll>

type StatusBaseData = z.infer<typeof StatusBase>

export type StatusAnnounce = StatusBaseData & {
  type: 'Announce'
  originalStatus: Status
}

export const StatusAnnounce: z.ZodType<StatusAnnounce> = StatusBase.extend({
  type: z.literal(StatusType.enum.Announce),
  originalStatus: z.lazy(() => Status)
})

export type Status = StatusNote | StatusPoll | StatusAnnounce
export const Status: z.ZodType<Status> = z.lazy(() =>
  z.union([StatusNote, StatusPoll, StatusAnnounce])
)

export const getOriginalStatus = (status: Status): StatusNote | StatusPoll => {
  if (status.type === StatusType.enum.Announce) {
    return getOriginalStatus(status.originalStatus)
  }

  return status
}

export const hasStatusBeenEdited = (status: Status): boolean => {
  const originalStatus = getOriginalStatus(status)
  return originalStatus.edits.length > 0
}

export const EditableStatus = z.union([StatusNote, StatusPoll])
export type EditableStatus = z.infer<typeof EditableStatus>

// Helper to extract actor ID from attributedTo which can be a string or object
// Some ActivityPub implementations (like Friendica) return an object instead of a string
const getActorIdFromAttributedTo = (
  attributedTo: string | { id: string } | unknown
): string => {
  if (typeof attributedTo === 'string') {
    return attributedTo
  }
  if (
    typeof attributedTo === 'object' &&
    attributedTo !== null &&
    'id' in attributedTo &&
    typeof (attributedTo as { id: unknown }).id === 'string'
  ) {
    return (attributedTo as { id: string }).id
  }
  throw new Error(
    `Invalid attributedTo format: ${JSON.stringify(attributedTo)}`
  )
}

// Helper to extract URL from note.url which can be a string, array of strings,
// or array of Link objects (some ActivityPub implementations like Mastodon return arrays)
// Note: The TypeScript schema types url as string | null | undefined, but some
// implementations like Mastodon/ruby.social actually send arrays
const getUrlFromNote = (note: Note): string => {
  const noteUrl = note.url as unknown
  if (typeof noteUrl === 'string') {
    return noteUrl
  }
  if (Array.isArray(noteUrl)) {
    const firstUrl = noteUrl.find(
      (item): item is string => typeof item === 'string'
    )
    if (firstUrl) {
      return firstUrl
    }
    // Some implementations return Link objects in the array
    const linkWithHref = noteUrl.find(
      (item): item is { href: string } =>
        typeof item === 'object' &&
        item !== null &&
        'href' in item &&
        typeof (item as { href: unknown }).href === 'string'
    )
    if (linkWithHref) {
      return linkWithHref.href
    }
  }
  return note.id
}

export const fromNote = (note: Note): StatusNote => {
  const currentTime = Date.now()
  const attachments = (
    Array.isArray(note.attachment) ? note.attachment : [note.attachment]
  ).filter((item): item is Document => item?.type === 'Document')

  const actorId = getActorIdFromAttributedTo(note.attributedTo)

  return StatusNote.parse({
    id: note.id,
    url: getUrlFromNote(note),

    actorId,
    actor: null,

    type: StatusType.enum.Note,

    text: getContent(note),
    summary: getSummary(note),
    // Resolve the note's declared language from its content/summary locale maps
    // so remote-fetched statuses (e.g. profile pages) carry it too. Without this
    // the Translate control never appears on those feeds, since it is gated on a
    // known source language. Federated/stored statuses get this via
    // createNoteJob/updateNoteJob; this is the same resolution for the
    // fetch-on-render path.
    language: getLanguage(note),
    // Content-detected language is NOT resolved here: this module's
    // StatusNote/Status types are imported throughout client components, and
    // language-detection statically pulls in tinyld's large N-gram tables.
    // Keeping any reference to it (even a dynamic import) out of this shared
    // module avoids that dependency leaking into client bundles. Callers that
    // need it for an ephemeral (not persisted) status — getActorPosts,
    // getRemoteStatus — attach it after calling fromNote.
    detectedLanguage: null,

    to: Array.isArray(note.to) ? note.to : [note.to].filter(identity),
    cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter(identity),
    edits: [],

    reply: getReply(note.inReplyTo) || '',
    replies: [],

    attachments: attachments.map((attachment) => ({
      id: attachment.url,
      actorId,
      statusId: note.id,
      type: 'Document',
      mediaType: attachment.mediaType,
      url: attachment.url,
      name: attachment.name ?? '',

      createdAt: currentTime,
      updatedAt: currentTime
    })),
    tags: [],

    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    isLocalActor: false,
    totalLikes: 0,

    createdAt: new Date(note.published).getTime(),
    updatedAt: currentTime
  })
}

export const fromAnnounce = (
  announce: AnnounceStatus | ActivityPubAnnounce,
  originalStatus: StatusNote | StatusPoll
): StatusAnnounce => {
  const currentTime = Date.now()
  return StatusAnnounce.parse({
    id: announce.id,

    actorId: announce.actor,
    actor: null,

    type: StatusType.enum.Announce,

    to: Array.isArray(announce.to)
      ? announce.to
      : [announce.to].filter(identity),
    cc: Array.isArray(announce.cc)
      ? announce.cc
      : [announce.cc].filter(identity),
    edits: [],

    originalStatus,

    isLocalActor: false,

    createdAt: new Date(announce.published).getTime(),
    updatedAt: currentTime
  })
}

export const toActivityPubObject = (status: Status): Note | Question => {
  if (status.type === StatusType.enum.Poll) {
    const pollOptions = status.choices.map((choice) => ({
      type: 'Note' as const,
      name: choice.title,
      replies: {
        type: 'Collection' as const,
        totalItems: choice.totalVotes
      }
    }))

    return Question.parse({
      id: status.id,
      type: ENTITY_TYPE_QUESTION,
      summary: status.summary || null,

      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      inReplyTo: status.reply || null,
      content: status.text,
      tag: status.tags
        .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
        .filter((tag) => tag !== null),

      ...(status.pollType === 'anyOf'
        ? { anyOf: pollOptions }
        : { oneOf: pollOptions }),
      replies: {
        id: `${status.id}/replies`,
        type: 'Collection',
        totalItems: status.replies.length,
        items: status.replies.map((reply) =>
          toActivityPubObject(Status.parse(reply))
        )
      },
      likes: {
        id: `${status.id}/likes`,
        type: 'Collection',
        totalItems: status.totalLikes
      },
      shares: {
        id: `${status.id}/shares`,
        type: 'Collection',
        totalItems: status.totalShares
      },

      published: getISOTimeUTC(status.createdAt),
      endTime: getISOTimeUTC(status.endAt),
      ...(status.pollType === 'oneOf'
        ? {
            votersCount: status.choices.reduce(
              (totalVotes, choice) => totalVotes + choice.totalVotes,
              0
            )
          }
        : {}),
      ...(status.endAt <= Date.now()
        ? { closed: getISOTimeUTC(status.endAt) }
        : {}),
      ...(hasStatusBeenEdited(status)
        ? { updated: getISOTimeUTC(status.updatedAt) }
        : null)
    })
  }

  const originalStatus = getOriginalStatus(status)
  return Note.parse({
    id: originalStatus.id,
    type: originalStatus.type,
    summary: originalStatus.summary || null,
    url: originalStatus.url,
    attributedTo: originalStatus.actorId,
    to: originalStatus.to,
    cc: originalStatus.cc,
    inReplyTo: originalStatus.reply || null,
    content: originalStatus.text,
    // Only the first MAX_FEDERATION_MEDIA_ATTACHMENTS federate (outbox and the
    // AP note/replies endpoints); a status may store more, but remote servers
    // receive a Mastodon-compatible payload. Mirrors getNoteFromStatus.
    attachment: originalStatus.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .slice(0, MAX_FEDERATION_MEDIA_ATTACHMENTS)
      .map((attachment) => getDocumentFromAttachment(attachment)),
    tag: originalStatus.tags
      .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
      .filter((tag) => tag !== null),
    replies: {
      id: `${originalStatus.id}/replies`,
      type: 'Collection',
      totalItems: originalStatus.replies.length,
      items: originalStatus.replies.map((reply) =>
        toActivityPubObject(Status.parse(reply))
      )
    },
    likes: {
      id: `${originalStatus.id}/likes`,
      type: 'Collection',
      totalItems: originalStatus.totalLikes
    },
    shares: {
      id: `${originalStatus.id}/shares`,
      type: 'Collection',
      totalItems: originalStatus.totalShares
    },

    published: getISOTimeUTC(originalStatus.createdAt),
    ...(hasStatusBeenEdited(originalStatus)
      ? { updated: getISOTimeUTC(originalStatus.updatedAt) }
      : null)
  })
}
