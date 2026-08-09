import { Database } from '@/lib/database/types'
import {
  FilterRecordWithStatusPublicIds,
  getEmittedFilterStatusId,
  getMastodonFilterFromRecord,
  hydrateFilterRecordStatusPublicIds
} from '@/lib/services/mastodon/getMastodonFilter'
import { Timeline } from '@/lib/services/timelines/types'
import { ActiveServerFilterRecord } from '@/lib/types/database/operations'
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
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
  const isValidCodePoint = (code: number): boolean =>
    Number.isFinite(code) && code >= 0 && code <= 0x10ffff
  return withoutTags.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (entity, ref) => {
      if (ref.startsWith('#x') || ref.startsWith('#X')) {
        const code = parseInt(ref.slice(2), 16)
        return isValidCodePoint(code) ? String.fromCodePoint(code) : entity
      }
      if (ref.startsWith('#')) {
        const code = parseInt(ref.slice(1), 10)
        return isValidCodePoint(code) ? String.fromCodePoint(code) : entity
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
    contents.push(stripHtml(target.summary))
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

// Every id form `filter_statuses.statusId` can hold for this status. A stored
// row matches whichever encoding was current when it was written: the
// ActivityPub URI (what the write route resolves to today), the legacy
// colon/`apurl_` form (pre-resolution rows), and the publicId (a post-flip
// client id the write route could not resolve, which it then stores verbatim).
//
// An Announce contributes both its own ids and the reblogged original's, so
// filtering either one hides the reblog. Both ids are in the serialized entity a
// client reads the result next to (the wrapper as `id`, the original as
// `reblog.id`), so whichever one the row named resolves.
//
// Deliberately a Set of ids and not a map back to the matched Status: what the
// match is REPORTED as comes from the hydrated row, never from the status in
// hand — see matchFilter.
const getCandidateStatusIds = (status: Status): Set<string> => {
  const target =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  const candidates = new Set<string>()
  const addCandidate = (id: string | null | undefined) => {
    if (id) candidates.add(id)
  }
  if (target) {
    addCandidate(target.id)
    addCandidate(urlToId(target.id))
    addCandidate(target.publicId)
  }
  if (status.type === StatusType.enum.Announce) {
    addCandidate(status.id)
    addCandidate(urlToId(status.id))
    addCandidate(status.publicId)
  }
  return candidates
}

// Instance-wide server filters carry no owning actor. Adapt them to the
// per-actor record shape so the matching pipeline can treat both kinds
// uniformly; the synthetic empty actorId is never read during matching. Server
// filters are keyword-only, so there is nothing to hydrate.
const serverRecordToActiveFilterRecord = (
  record: ActiveServerFilterRecord
): FilterRecordWithStatusPublicIds => ({
  filter: { ...record.filter, actorId: '' },
  keywords: record.keywords,
  statuses: []
})

export const getActiveFilters = async (
  database: Database,
  actorId: string | undefined,
  context: FilterContext
): Promise<FilterRecordWithStatusPublicIds[]> => {
  // Server filters apply to everyone — including signed-out viewers — so they
  // are fetched regardless of `actorId`.
  const [accountRecords, serverRecords] = await Promise.all([
    actorId
      ? database.getActiveFiltersForActor({ actorId, context })
      : Promise.resolve([]),
    database.getActiveServerFilters({ context })
  ])
  // The matching pipeline below is synchronous and runs per status, so the rows'
  // publicIds are resolved once here — in a single query for the whole set, and
  // in none at all for the common keyword-only filter.
  const hydratedAccountRecords = await hydrateFilterRecordStatusPublicIds(
    database,
    accountRecords
  )
  return [
    ...hydratedAccountRecords,
    ...serverRecords.map(serverRecordToActiveFilterRecord)
  ]
}

const matchFilter = (
  contents: string[],
  candidateStatusIds: ReadonlySet<string>,
  record: FilterRecordWithStatusPublicIds
): Mastodon.FilterResult | null => {
  const keywordMatches: string[] = []
  for (const keyword of record.keywords) {
    const matcher = getCachedMatcher(keyword)
    if (contents.some((content) => matcher.test(content))) {
      keywordMatches.push(keyword.keyword)
    }
  }

  const statusMatches: string[] = []
  for (const filterStatus of record.statuses) {
    // Match on any stored form, but name the match with getEmittedFilterStatusId
    // — the SAME function, reading the SAME hydrated row, that produces the
    // `filter.statuses[]` entry emitted beside it in this very object. That is
    // what makes the two agree: not that each independently reconstructs the
    // same id, but that there is only one id and one place it comes from. It
    // matters because `status_matches` rides on every timeline and notification
    // status carrying `filtered[]`, where a client compares it against ids the
    // response already gave it — and a document naming one status two ways is
    // unresolvable.
    const matched =
      candidateStatusIds.has(filterStatus.statusId) ||
      candidateStatusIds.has(urlToId(filterStatus.statusId))
    if (matched) statusMatches.push(getEmittedFilterStatusId(filterStatus))
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
  filters: FilterRecordWithStatusPublicIds[]
): Mastodon.FilterResult[] => {
  if (filters.length === 0) return []
  const contents = getStatusContents(status)
  const candidateStatusIds = getCandidateStatusIds(status)
  const results: Mastodon.FilterResult[] = []
  for (const record of filters) {
    const match = matchFilter(contents, candidateStatusIds, record)
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
  filters: FilterRecordWithStatusPublicIds[]
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
  filters: FilterRecordWithStatusPublicIds[]
): Mastodon.Status[] => {
  if (filters.length === 0) return mastodonStatuses
  const filteredByStatusId = new Map<string, Mastodon.FilterResult[]>()
  for (const status of domainStatuses) {
    const matches = applyFiltersToStatus(status, filters)
    if (matches.length > 0) {
      filteredByStatusId.set(status.id, matches)
      filteredByStatusId.set(urlToId(status.id), matches)
      // The serialized entity is keyed by its EMITTED id, which is the
      // publicId whenever the row has one — `urlToId` cannot produce that, so
      // without this key every annotation silently disappears post-flip. The
      // two keys above still cover a row that predates the backfill (its
      // emitted id is the colon form) and lookups made by URI.
      if (status.publicId) filteredByStatusId.set(status.publicId, matches)
    }
  }
  return mastodonStatuses.map((status) => {
    const matches =
      filteredByStatusId.get(status.id) ??
      filteredByStatusId.get(urlToId(status.id))
    if (!matches || matches.length === 0) return status
    // For reblogs the filter result belongs on the inner content object
    if (status.reblog) {
      return { ...status, reblog: { ...status.reblog, filtered: matches } }
    }
    return { ...status, filtered: matches }
  })
}

export const dropHideMatchesFromStatuses = <T extends Status>(
  statuses: T[],
  filters: FilterRecordWithStatusPublicIds[]
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
