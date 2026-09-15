import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import { filterBlockedStatuses } from '@/lib/services/timelines/blockFilter'
import { filterMutedStatuses } from '@/lib/services/timelines/muteFilter'
import { Actor, Database, Status } from '@/lib/types/database'
import { StatusType } from '@/lib/types/domain/status'
import {
  TimelineContext,
  TimelineParentPreview
} from '@/lib/types/domain/timeline'
import { getVisibility } from '@/lib/utils/getVisibility'

interface ParentRef {
  parentId?: string
  parentUrl?: string
}

const getParentRef = (status: Status): ParentRef | null => {
  if (status.type === StatusType.enum.Announce) {
    return null
  }
  const s = status as Record<string, unknown>

  const rawInReplyToId =
    typeof s.inReplyToId === 'string'
      ? s.inReplyToId.trim()
      : typeof s.in_reply_to_id === 'string'
        ? s.in_reply_to_id.trim()
        : ''

  const rawReplyToUrl =
    typeof s.replyToUrl === 'string'
      ? s.replyToUrl.trim()
      : typeof s.inReplyToUrl === 'string'
        ? s.inReplyToUrl.trim()
        : ''

  const rawReply = typeof s.reply === 'string' ? s.reply.trim() : ''

  const candidate = rawInReplyToId || rawReplyToUrl || rawReply
  if (!candidate) return null

  const isUrl =
    candidate.startsWith('http://') || candidate.startsWith('https://')

  return {
    parentId: rawInReplyToId || (!isUrl ? candidate : candidate),
    parentUrl: rawReplyToUrl || (isUrl ? candidate : undefined)
  }
}

export async function getTimelineContext({
  database,
  currentActor,
  statuses
}: {
  database: Database
  currentActor?: Actor
  statuses: Status[]
}): Promise<TimelineContext> {
  const allResolvedStatuses = new Map<string, Status>()
  const resolvedKeys = new Set<string>()
  const queriedKeys = new Set<string>()

  const trackStatus = (status: Status) => {
    allResolvedStatuses.set(status.id, status)
    resolvedKeys.add(status.id)
    const s = status as Record<string, unknown>
    if (typeof s.url === 'string' && s.url) resolvedKeys.add(s.url)
    if (typeof s.uri === 'string' && s.uri) resolvedKeys.add(s.uri)
    if (typeof s.publicId === 'string' && s.publicId)
      resolvedKeys.add(s.publicId)
  }

  const initialStatusIds = new Set<string>()
  for (const status of statuses) {
    trackStatus(status)
    initialStatusIds.add(status.id)
  }

  const MAX_ROUNDS = 3
  const MAX_TOTAL_STATUSES = 80

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (allResolvedStatuses.size >= MAX_TOTAL_STATUSES) {
      break
    }

    const missingParentIds = new Set<string>()
    const missingParentUrls = new Set<string>()

    for (const status of allResolvedStatuses.values()) {
      const parentRef = getParentRef(status)
      if (!parentRef) continue

      const { parentId, parentUrl } = parentRef
      if (
        parentId &&
        !resolvedKeys.has(parentId) &&
        !queriedKeys.has(parentId)
      ) {
        missingParentIds.add(parentId)
      }
      if (
        parentUrl &&
        !resolvedKeys.has(parentUrl) &&
        !queriedKeys.has(parentUrl)
      ) {
        missingParentUrls.add(parentUrl)
      }
    }

    if (missingParentIds.size === 0 && missingParentUrls.size === 0) {
      break
    }

    for (const id of missingParentIds) queriedKeys.add(id)
    for (const url of missingParentUrls) queriedKeys.add(url)

    const newFoundStatuses: Status[] = []
    const newFoundIds = new Set<string>()

    if (missingParentIds.size > 0) {
      const remainingLimit = MAX_TOTAL_STATUSES - allResolvedStatuses.size
      const idsToFetch = Array.from(missingParentIds).slice(0, remainingLimit)
      const fetched = await database.getStatusesByIds({ statusIds: idsToFetch })
      for (const s of fetched) {
        if (!newFoundIds.has(s.id) && !allResolvedStatuses.has(s.id)) {
          newFoundIds.add(s.id)
          newFoundStatuses.push(s)
        }
      }
    }

    if (database.getStatusFromUrl && missingParentUrls.size > 0) {
      for (const url of missingParentUrls) {
        if (
          allResolvedStatuses.size + newFoundStatuses.length >=
          MAX_TOTAL_STATUSES
        ) {
          break
        }
        const alreadyFoundInRound = newFoundStatuses.some(
          (s) =>
            (s as Record<string, unknown>).url === url ||
            (s as Record<string, unknown>).uri === url ||
            s.id === url
        )
        if (alreadyFoundInRound || resolvedKeys.has(url)) {
          continue
        }

        try {
          const statusFromUrl = await database.getStatusFromUrl({ url })
          if (
            statusFromUrl &&
            !newFoundIds.has(statusFromUrl.id) &&
            !allResolvedStatuses.has(statusFromUrl.id)
          ) {
            newFoundIds.add(statusFromUrl.id)
            newFoundStatuses.push(statusFromUrl)
          }
        } catch {
          // Gracefully skip URL resolution failure
        }
      }
    }

    if (newFoundStatuses.length === 0) {
      break
    }

    let readableStatuses = await filterReadableStatuses({
      database,
      currentActor: currentActor ?? null,
      statuses: newFoundStatuses
    })

    if (currentActor) {
      readableStatuses = await filterBlockedStatuses(
        database,
        currentActor.id,
        readableStatuses
      )
      readableStatuses = await filterMutedStatuses(
        database,
        currentActor.id,
        readableStatuses
      )
    }

    if (readableStatuses.length === 0) {
      break
    }

    for (const status of readableStatuses) {
      if (allResolvedStatuses.size >= MAX_TOTAL_STATUSES) {
        break
      }
      trackStatus(status)
    }
  }

  const ancestorsById: Record<string, TimelineParentPreview> = {}

  for (const [id, status] of allResolvedStatuses.entries()) {
    if (initialStatusIds.has(id)) {
      continue
    }

    const s = status as Record<string, unknown>

    const rawSpoiler =
      (typeof s.spoilerText === 'string' && s.spoilerText.trim()) ||
      (typeof s.spoiler_text === 'string' && s.spoiler_text.trim()) ||
      (typeof s.summary === 'string' && s.summary.trim()) ||
      ''

    const isSensitive = Boolean(
      s.sensitive ?? s.isSensitive ?? rawSpoiler.length > 0
    )

    const spoilerText = rawSpoiler.length > 0 ? rawSpoiler : undefined
    const hideContent = isSensitive || Boolean(spoilerText)

    const rawContentHtml =
      typeof s.contentHtml === 'string'
        ? s.contentHtml
        : typeof s.content === 'string'
          ? s.content
          : typeof s.text === 'string'
            ? s.text
            : ''

    const rawText =
      typeof s.text === 'string'
        ? s.text
        : typeof s.content === 'string'
          ? s.content
          : ''

    const contentHtml = hideContent ? '' : rawContentHtml
    const text = hideContent ? '' : rawText

    const createdAt =
      typeof status.createdAt === 'string'
        ? status.createdAt
        : new Date(status.createdAt).toISOString()

    const actorProfile = status.actor
    const rawActor = (actorProfile ?? {}) as Record<string, unknown>

    const actor = {
      id: (rawActor.id as string) ?? status.actorId ?? '',
      username: (rawActor.username as string) ?? '',
      domain: (rawActor.domain as string) ?? '',
      name:
        typeof rawActor.name === 'string'
          ? rawActor.name
          : typeof rawActor.display_name === 'string'
            ? rawActor.display_name
            : undefined,
      avatarUrl:
        typeof rawActor.iconUrl === 'string'
          ? rawActor.iconUrl
          : typeof rawActor.avatarUrl === 'string'
            ? rawActor.avatarUrl
            : typeof rawActor.avatar === 'string'
              ? rawActor.avatar
              : undefined
    }

    const parentRef = getParentRef(status)

    const visibility =
      (s.visibility as Status['visibility']) ??
      getVisibility(
        (status.to as string[]) ?? [],
        (status.cc as string[]) ?? []
      )

    const preview: TimelineParentPreview = {
      id: status.id,
      url: typeof s.url === 'string' ? s.url : undefined,
      actor,
      contentHtml,
      text,
      spoilerText,
      isSensitive,
      createdAt,
      inReplyToId: parentRef?.parentId,
      inReplyToUrl: parentRef?.parentUrl,
      visibility
    }

    ancestorsById[status.id] = preview
    if (typeof s.url === 'string' && s.url) ancestorsById[s.url] = preview
    if (typeof s.uri === 'string' && s.uri) ancestorsById[s.uri] = preview
    if (typeof s.publicId === 'string' && s.publicId)
      ancestorsById[s.publicId] = preview
  }

  return { ancestorsById }
}
