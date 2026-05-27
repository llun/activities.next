import { Database } from '@/lib/database/types'
import { getMastodonFilterFromRecord } from '@/lib/services/mastodon/getMastodonFilter'
import { Timeline } from '@/lib/services/timelines/types'
import { ActiveFilterRecord } from '@/lib/types/database/operations'
import {
  FilterKeyword as DomainFilterKeyword,
  FilterContext
} from '@/lib/types/domain/filter'
import { Status, StatusType } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import { urlToId } from '@/lib/utils/urlToId'

export const getFilterContextForTimeline = (
  timeline: Timeline
): FilterContext => {
  if (timeline === Timeline.LOCAL_PUBLIC) return 'public'
  return 'home'
}

const KEYWORD_REGEX_CACHE_LIMIT = 1024
const KEYWORD_REGEX_CACHE = new Map<
  string,
  { matcher: RegExp; updatedAt: number; signature: string }
>()

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const UNICODE_WORD_LEAD = /^[\p{L}\p{N}_]/u
const UNICODE_WORD_TRAIL = /[\p{L}\p{N}_]$/u
const NON_WORD = '[^\\p{L}\\p{N}_]'

export const buildKeywordMatcher = (
  keyword: string,
  wholeWord: boolean
): RegExp => {
  if (!wholeWord) {
    return new RegExp(escapeRegExp(keyword), 'iu')
  }
  const lead = UNICODE_WORD_LEAD.test(keyword) ? `(?:^|${NON_WORD})` : ''
  const trail = UNICODE_WORD_TRAIL.test(keyword) ? `(?:${NON_WORD}|$)` : ''
  return new RegExp(`${lead}${escapeRegExp(keyword)}${trail}`, 'iu')
}

const getCachedMatcher = (keyword: DomainFilterKeyword): RegExp => {
  const signature = `${keyword.keyword}:${keyword.wholeWord ? '1' : '0'}`
  const cached = KEYWORD_REGEX_CACHE.get(keyword.id)
  if (
    cached &&
    cached.updatedAt === keyword.updatedAt &&
    cached.signature === signature
  ) {
    KEYWORD_REGEX_CACHE.delete(keyword.id)
    KEYWORD_REGEX_CACHE.set(keyword.id, cached)
    return cached.matcher
  }

  const matcher = buildKeywordMatcher(keyword.keyword, keyword.wholeWord)
  KEYWORD_REGEX_CACHE.set(keyword.id, {
    matcher,
    updatedAt: keyword.updatedAt,
    signature
  })

  if (KEYWORD_REGEX_CACHE.size > KEYWORD_REGEX_CACHE_LIMIT) {
    const oldestKey = KEYWORD_REGEX_CACHE.keys().next().value
    if (oldestKey !== undefined) KEYWORD_REGEX_CACHE.delete(oldestKey)
  }
  return matcher
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

const stripHtml = (html: string): string => {
  const withoutTags = html
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
  return withoutTags.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (entity, ref) => {
      if (ref.startsWith('#x') || ref.startsWith('#X')) {
        const code = parseInt(ref.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity
      }
      if (ref.startsWith('#')) {
        const code = parseInt(ref.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity
      }
      return HTML_ENTITY_MAP[ref.toLowerCase()] ?? entity
    }
  )
}

const getStatusContents = (status: Status): string[] => {
  const target =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  if (!target) return []

  const contents: string[] = []
  if ('text' in target && typeof target.text === 'string') {
    contents.push(stripHtml(target.text))
  }
  if (
    'summary' in target &&
    typeof target.summary === 'string' &&
    target.summary
  ) {
    contents.push(target.summary)
  }
  if (target.type === StatusType.enum.Poll && Array.isArray(target.choices)) {
    for (const choice of target.choices) {
      if (choice && typeof choice.title === 'string') {
        contents.push(choice.title)
      }
    }
  }
  return contents
}

const getCandidateStatusIds = (status: Status): string[] => {
  const target =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  const ids = new Set<string>()
  if (target) {
    ids.add(target.id)
    ids.add(urlToId(target.id))
  }
  if (status.type === StatusType.enum.Announce) {
    ids.add(status.id)
    ids.add(urlToId(status.id))
  }
  return [...ids].filter(Boolean)
}

export const getActiveFilters = async (
  database: Database,
  actorId: string | undefined,
  context: FilterContext
): Promise<ActiveFilterRecord[]> => {
  if (!actorId) return []
  return database.getActiveFiltersForActor({ actorId, context })
}

const matchFilter = (
  status: Status,
  contents: string[],
  candidateIds: string[],
  record: ActiveFilterRecord
): Mastodon.FilterResult | null => {
  const keywordMatches: string[] = []
  for (const keyword of record.keywords) {
    const matcher = getCachedMatcher(keyword)
    if (contents.some((content) => matcher.test(content))) {
      keywordMatches.push(keyword.keyword)
    }
  }

  const candidateIdSet = new Set(candidateIds)
  const statusMatches: string[] = []
  for (const filterStatus of record.statuses) {
    if (
      candidateIdSet.has(filterStatus.statusId) ||
      candidateIdSet.has(urlToId(filterStatus.statusId))
    ) {
      statusMatches.push(filterStatus.id)
    }
  }

  if (keywordMatches.length === 0 && statusMatches.length === 0) return null
  return {
    filter: getMastodonFilterFromRecord(record),
    keyword_matches: keywordMatches.length > 0 ? keywordMatches : null,
    status_matches: statusMatches.length > 0 ? statusMatches : null
  }
}

export const applyFiltersToStatus = (
  status: Status,
  filters: ActiveFilterRecord[]
): Mastodon.FilterResult[] => {
  if (filters.length === 0) return []
  const contents = getStatusContents(status)
  const candidateIds = getCandidateStatusIds(status)
  const results: Mastodon.FilterResult[] = []
  for (const record of filters) {
    const match = matchFilter(status, contents, candidateIds, record)
    if (match) results.push(match)
  }
  return results
}

export interface PartitionResult<T extends Status> {
  visible: { status: T; filtered: Mastodon.FilterResult[] }[]
  droppedIds: string[]
}

export const partitionStatusesByFilters = <T extends Status>(
  statuses: T[],
  filters: ActiveFilterRecord[]
): PartitionResult<T> => {
  if (filters.length === 0) {
    return {
      visible: statuses.map((status) => ({ status, filtered: [] })),
      droppedIds: []
    }
  }

  const visible: { status: T; filtered: Mastodon.FilterResult[] }[] = []
  const droppedIds: string[] = []

  for (const status of statuses) {
    const matches = applyFiltersToStatus(status, filters)
    const hideMatch = matches.find(
      (match) => match.filter.filter_action === 'hide'
    )
    if (hideMatch) {
      droppedIds.push(status.id)
      continue
    }
    visible.push({ status, filtered: matches })
  }

  return { visible, droppedIds }
}

export const annotateMastodonStatusesWithFilters = (
  mastodonStatuses: Mastodon.Status[],
  domainStatuses: Status[],
  filters: ActiveFilterRecord[]
): Mastodon.Status[] => {
  if (filters.length === 0) return mastodonStatuses
  const filteredByStatusId = new Map<string, Mastodon.FilterResult[]>()
  for (const status of domainStatuses) {
    const matches = applyFiltersToStatus(status, filters)
    if (matches.length > 0) {
      filteredByStatusId.set(status.id, matches)
      filteredByStatusId.set(urlToId(status.id), matches)
    }
  }
  return mastodonStatuses.map((status) => {
    const matches =
      filteredByStatusId.get(status.id) ??
      filteredByStatusId.get(urlToId(status.id))
    if (!matches || matches.length === 0) return status
    return { ...status, filtered: matches }
  })
}

export const dropHideMatchesFromStatuses = <T extends Status>(
  statuses: T[],
  filters: ActiveFilterRecord[]
): T[] => {
  if (filters.length === 0) return statuses
  const hideFilters = filters.filter(
    (record) => record.filter.filterAction === 'hide'
  )
  if (hideFilters.length === 0) return statuses
  return statuses.filter(
    (status) => applyFiltersToStatus(status, hideFilters).length === 0
  )
}
