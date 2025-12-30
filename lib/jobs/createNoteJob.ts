import { Note } from '@llun/activities.schema'
import identity from 'lodash/identity'

import { recordActorIfNeeded } from '../actions/utils'
import {
  getContent,
  getSummary,
  getTags
} from '../activities/entities/note'
import { StatusType } from '../models/status'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT,
  ACTIVITY_STREAM_URL
} from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME } from './names'

type ActivityObject = Record<string, unknown>
type AttachmentLike = {
  type?: unknown
  url?: unknown
  mediaType?: unknown
  width?: unknown
  height?: unknown
  name?: unknown
}

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const getStringArray = (value: unknown): string[] =>
  asArray(value).filter((item): item is string => typeof item === 'string')

const normalizeRecipient = (recipient: string) =>
  recipient === ACTIVITY_STREAM_PUBLIC_COMPACT
    ? ACTIVITY_STREAM_PUBLIC
    : recipient

const getContentFromObject = (object: ActivityObject) =>
  getContent(object as Note)

const getSummaryFromObject = (object: ActivityObject) =>
  getSummary(object as Note)

const getPublishedTime = (value: unknown) => {
  if (typeof value !== 'string') return Date.now()
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? Date.now() : timestamp
}

const getUrlEntry = (value: unknown): { url: string; mediaType?: string } | null => {
  if (typeof value === 'string') return { url: value }
  if (!value || typeof value !== 'object') return null
  const urlObject = value as { href?: unknown; url?: unknown; mediaType?: unknown }
  if (typeof urlObject.href === 'string') {
    return {
      url: urlObject.href,
      ...(typeof urlObject.mediaType === 'string'
        ? { mediaType: urlObject.mediaType }
        : null)
    }
  }
  if (typeof urlObject.url === 'string') {
    return {
      url: urlObject.url,
      ...(typeof urlObject.mediaType === 'string'
        ? { mediaType: urlObject.mediaType }
        : null)
    }
  }
  return null
}

const getPrimaryUrl = (
  value: unknown
): { url: string; mediaType?: string } | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = getUrlEntry(entry)
      if (parsed) return parsed
    }
    return null
  }
  return getUrlEntry(value)
}

const getMediaTypeFromUrl = (url: string): string | null => {
  const lowerUrl = url.toLowerCase().split('?')[0]
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerUrl.endsWith('.png')) return 'image/png'
  if (lowerUrl.endsWith('.gif')) return 'image/gif'
  if (lowerUrl.endsWith('.webp')) return 'image/webp'
  if (lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.m4v'))
    return 'video/mp4'
  if (lowerUrl.endsWith('.webm')) return 'video/webm'
  if (lowerUrl.endsWith('.mov')) return 'video/quicktime'
  return null
}

const getMediaType = (
  item: AttachmentLike,
  urlMediaType: string | undefined,
  url: string
) => {
  if (typeof item.mediaType === 'string' && item.mediaType.length > 0) {
    return item.mediaType
  }
  if (urlMediaType) return urlMediaType
  if (item.type === 'Image') return 'image/unknown'
  if (item.type === 'Video') return 'video/unknown'
  return getMediaTypeFromUrl(url)
}

const getAttachmentItems = (object: ActivityObject): AttachmentLike[] => {
  const attachments = asArray(object.attachment)
  const objectType = typeof object.type === 'string' ? object.type : ''
  if (objectType === 'Image' || objectType === 'Video') {
    return attachments.length > 0
      ? (attachments as AttachmentLike[])
      : [object as AttachmentLike]
  }
  return attachments as AttachmentLike[]
}

export const createNoteJob = createJobHandle(
  CREATE_NOTE_JOB_NAME,
  async (database, message) => {
    const compactObject = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...(message.data as ActivityObject)
    })) as ActivityObject
    const noteResult = Note.safeParse(compactObject)
    const objectType = compactObject.type
    const isMediaObject =
      objectType === 'Image' || objectType === 'Video' || objectType === 'Note'
    if (!noteResult.success && !isMediaObject) {
      return
    }

    const statusId =
      typeof compactObject.id === 'string' ? compactObject.id : null
    if (!statusId) return

    const existingStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    if (objectType !== StatusType.enum.Note && !isMediaObject) {
      return
    }

    const actorId =
      typeof compactObject.attributedTo === 'string'
        ? compactObject.attributedTo
        : null
    if (!actorId) return

    const text = getContentFromObject(compactObject)
    const summary = getSummaryFromObject(compactObject)
    const createdAt = getPublishedTime(compactObject.published)

    const [, status] = await Promise.all([
      recordActorIfNeeded({ actorId, database }),
      database.createNote({
        id: statusId,
        url: typeof compactObject.url === 'string' ? compactObject.url : statusId,

        actorId,

        text,
        summary,

        to: getStringArray(compactObject.to)
          .filter(identity)
          .map(normalizeRecipient),
        cc: getStringArray(compactObject.cc)
          .filter(identity)
          .map(normalizeRecipient),

        reply:
          typeof compactObject.inReplyTo === 'string'
            ? compactObject.inReplyTo
            : '',
        createdAt
      })
    ])

    const attachments = getAttachmentItems(compactObject)
    const tags = getTags(compactObject as Note)

    await Promise.all([
      addStatusToTimelines(database, status),
      ...attachments.map(async (attachment) => {
        const primaryUrl = getPrimaryUrl(attachment.url)
        if (!primaryUrl) return
        const mediaType = getMediaType(
          attachment,
          primaryUrl.mediaType,
          primaryUrl.url
        )
        if (!mediaType) return
        return database.createAttachment({
          actorId,
          statusId,
          mediaType,
          height:
            typeof attachment.height === 'number' ? attachment.height : undefined,
          width:
            typeof attachment.width === 'number' ? attachment.width : undefined,
          name: typeof attachment.name === 'string' ? attachment.name : '',
          url: primaryUrl.url
        })
      }),
      ...tags.map((item) => {
        if (
          item?.type === 'Emoji' &&
          typeof item.name === 'string' &&
          typeof item.icon?.url === 'string'
        ) {
          return database.createTag({
            statusId,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        if (
          typeof item?.name !== 'string' ||
          typeof item?.href !== 'string'
        ) {
          return
        }
        return database.createTag({
          statusId,
          name: item.name,
          value: item.href,
          type: 'mention'
        })
      })
    ])
  }
)
