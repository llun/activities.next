import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { MastodonVisibility, getVisibility } from '@/lib/utils/getVisibility'

export type ReplyMentionMode = 'all' | 'author-first' | 'author-only'

export interface ReplyTargetPreview {
  id: string
  authorName: string
  authorHandle: string
  authorIconUrl?: string
  textSnippet: string
  spoilerText?: string
  visibility: MastodonVisibility
  language?: string | null
  isPoll: boolean
}

export interface ExtractedParticipants {
  authorMention: string | null
  otherMentions: string[]
  allMentions: string[]
  isSelfReply: boolean
}

export interface PreparedReplyDraft {
  initialText: string
  cursorPosition: number
  spoilerText: string
  isSpoilerVisible: boolean
  visibility: MastodonVisibility
  language?: string
  targetPreview: ReplyTargetPreview
  mentionMode: ReplyMentionMode
  mentions: {
    author: string | null
    others: string[]
    all: string[]
  }
}

export interface ViewerIdentity {
  id: string
  username: string
  domain: string
}

const stripHtml = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const createTextSnippet = (text: string, maxLength = 140): string => {
  const clean = stripHtml(text)
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`
}

const normalizeHandle = (handle: string): string =>
  handle.toLowerCase().replace(/^@+/, '')

const isSameAccount = (
  candidate: {
    id?: string
    username?: string
    domain?: string
    handle?: string
  },
  target: ViewerIdentity
): boolean => {
  if (candidate.id && target.id && candidate.id === target.id) {
    return true
  }
  const targetUsername = target.username.toLowerCase()
  const targetDomain = target.domain.toLowerCase()

  if (candidate.username && candidate.domain) {
    return (
      candidate.username.toLowerCase() === targetUsername &&
      candidate.domain.toLowerCase() === targetDomain
    )
  }

  if (candidate.handle) {
    const norm = normalizeHandle(candidate.handle)
    const parts = norm.split('@')
    if (parts.length === 2) {
      return (
        parts[0].toLowerCase() === targetUsername &&
        parts[1].toLowerCase() === targetDomain
      )
    }
    if (parts.length === 1) {
      return parts[0].toLowerCase() === targetUsername
    }
  }

  return false
}

const formatMentionTag = (tag: { name: string; value: string }): string => {
  let name = tag.name.trim()
  if (!name.startsWith('@')) {
    name = `@${name}`
  }
  if (!name.slice(1).includes('@')) {
    try {
      const url = new URL(tag.value)
      return `${name}@${url.host}`
    } catch {
      return name
    }
  }
  return name
}

/**
 * Extracts and deduplicates participants from a reply target status.
 * Excludes the current viewer and ensures author is not duplicated in mentions.
 */
export const extractParticipants = (
  targetStatus: Status,
  currentViewer: ActorProfile | ViewerIdentity
): ExtractedParticipants => {
  const actualStatus = getOriginalStatus(targetStatus)
  const isSelfReply = isSameAccount(
    {
      id: actualStatus.actorId,
      username: actualStatus.actor?.username,
      domain: actualStatus.actor?.domain
    },
    currentViewer
  )

  const authorHandle = actualStatus.actor
    ? getMention(actualStatus.actor, true)
    : getMentionFromActorID(actualStatus.actorId, true)

  const authorMention = isSelfReply ? null : authorHandle

  // Identify mentions in parent tags
  const seenMentions = new Set<string>()
  // If not self-reply, author is already identified; mark author variants as seen
  if (authorMention) {
    seenMentions.add(normalizeHandle(authorMention))
    if (actualStatus.actor) {
      seenMentions.add(
        `${actualStatus.actor.username}@${actualStatus.actor.domain}`.toLowerCase()
      )
      seenMentions.add(actualStatus.actor.username.toLowerCase())
    }
  }
  // Mark viewer variants as seen
  seenMentions.add(
    `${currentViewer.username}@${currentViewer.domain}`.toLowerCase()
  )
  seenMentions.add(currentViewer.username.toLowerCase())
  if (currentViewer.id) {
    seenMentions.add(currentViewer.id.toLowerCase())
  }

  const otherMentions: string[] = []

  for (const tag of actualStatus.tags) {
    if (tag.type !== 'mention') continue
    const formatted = formatMentionTag(tag)
    const norm = normalizeHandle(formatted)

    // Check if tag refers to viewer
    if (
      (tag.value && currentViewer.id && tag.value === currentViewer.id) ||
      isSameAccount({ handle: formatted, id: tag.value }, currentViewer)
    ) {
      continue
    }

    // Check if tag refers to author or already seen
    if (
      (tag.value &&
        actualStatus.actorId &&
        tag.value === actualStatus.actorId) ||
      (actualStatus.actor &&
        isSameAccount(
          { handle: formatted, id: tag.value },
          {
            id: actualStatus.actorId,
            username: actualStatus.actor.username,
            domain: actualStatus.actor.domain
          }
        )) ||
      seenMentions.has(norm) ||
      (tag.value && seenMentions.has(tag.value.toLowerCase()))
    ) {
      continue
    }

    seenMentions.add(norm)
    if (tag.value) seenMentions.add(tag.value.toLowerCase())
    otherMentions.push(formatted)
  }

  const allMentions = [authorMention, ...otherMentions].filter(
    (m): m is string => Boolean(m)
  )

  return {
    authorMention,
    otherMentions,
    allMentions,
    isSelfReply
  }
}

/**
 * Computes composer text and cursor position according to the mention mode:
 * - `all`: author first, then all mentions in-line with trailing space.
 * - `author-first`: author first, then 2 newlines and other mentions (cursor after author).
 * - `author-only`: author only with trailing space (empty if self-reply).
 */
export const computeMentionText = (
  participants: { authorMention: string | null; otherMentions: string[] },
  mode: ReplyMentionMode = 'all'
): { text: string; cursorPosition: number } => {
  const { authorMention, otherMentions } = participants

  if (mode === 'author-only') {
    if (authorMention) {
      const text = `${authorMention} `
      return { text, cursorPosition: text.length }
    }
    return { text: '', cursorPosition: 0 }
  }

  if (mode === 'author-first') {
    if (authorMention && otherMentions.length > 0) {
      const text = `${authorMention} \n\n${otherMentions.join(' ')}`
      // Cursor right after the author mention and its trailing space
      const cursorPosition = authorMention.length + 1
      return { text, cursorPosition }
    }
    if (authorMention) {
      const text = `${authorMention} `
      return { text, cursorPosition: text.length }
    }
    if (otherMentions.length > 0) {
      const text = `${otherMentions.join(' ')} `
      return { text, cursorPosition: text.length }
    }
    return { text: '', cursorPosition: 0 }
  }

  // mode === 'all'
  const all = [authorMention, ...otherMentions].filter((m): m is string =>
    Boolean(m)
  )
  if (all.length > 0) {
    const text = `${all.join(' ')} `
    return { text, cursorPosition: text.length }
  }
  return { text: '', cursorPosition: 0 }
}

/**
 * Pure draft initialization helper for reply composers.
 * Resolves CW, visibility, declared language, target preview, and mention mode.
 */
export const prepareReplyDraft = ({
  targetStatus,
  currentViewer,
  mentionMode = 'all',
  defaultLanguage = null
}: {
  targetStatus: Status
  currentViewer: ActorProfile | ViewerIdentity
  mentionMode?: ReplyMentionMode
  defaultLanguage?: string | null
}): PreparedReplyDraft => {
  const actualStatus = getOriginalStatus(targetStatus)
  const participants = extractParticipants(actualStatus, currentViewer)
  const { text: initialText, cursorPosition } = computeMentionText(
    participants,
    mentionMode
  )

  const spoilerText = actualStatus.summary?.trim() || ''
  const isSpoilerVisible = Boolean(spoilerText)

  // Inherit visibility: direct stays direct, private stays private, unlisted stays unlisted, public stays public
  const parentVisibility = getVisibility(actualStatus.to, actualStatus.cc)
  const visibility = parentVisibility

  // Inherit declared language; do NOT substitute detectedLanguage
  const language = actualStatus.language?.trim() || defaultLanguage || undefined

  const authorName =
    actualStatus.actor?.name || actualStatus.actor?.username || 'Unknown'
  const authorHandle = actualStatus.actor
    ? actualStatus.actor.domain
      ? `@${actualStatus.actor.username}@${actualStatus.actor.domain}`
      : `@${actualStatus.actor.username}`
    : getMentionFromActorID(actualStatus.actorId, true)

  const targetPreview: ReplyTargetPreview = {
    id: actualStatus.id,
    authorName,
    authorHandle,
    authorIconUrl: actualStatus.actor?.iconUrl,
    textSnippet: createTextSnippet(actualStatus.text),
    spoilerText: spoilerText || undefined,
    visibility,
    language: actualStatus.language ?? null,
    isPoll: actualStatus.type === StatusType.enum.Poll
  }

  return {
    initialText,
    cursorPosition,
    spoilerText,
    isSpoilerVisible,
    visibility,
    language,
    targetPreview,
    mentionMode,
    mentions: {
      author: participants.authorMention,
      others: participants.otherMentions,
      all: participants.allMentions
    }
  }
}
