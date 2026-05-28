import { Database } from '@/lib/database/types'
import { ActiveFilterRecord } from '@/lib/types/database/operations'
import {
  Filter as DomainFilter,
  FilterKeyword as DomainFilterKeyword,
  FilterStatus as DomainFilterStatus
} from '@/lib/types/domain/filter'
import * as Mastodon from '@/lib/types/mastodon'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getMastodonFilterKeyword = (
  keyword: DomainFilterKeyword
): Mastodon.FilterKeyword => ({
  id: keyword.id,
  keyword: keyword.keyword,
  whole_word: keyword.wholeWord
})

export const getMastodonFilterStatus = (
  status: DomainFilterStatus
): Mastodon.FilterStatus => ({
  id: status.id,
  status_id: status.statusId
})

const buildMastodonFilter = (record: ActiveFilterRecord): Mastodon.Filter => ({
  id: record.filter.id,
  title: record.filter.title,
  context: record.filter.context,
  expires_at:
    record.filter.expiresAt !== null
      ? getISOTimeUTC(record.filter.expiresAt)
      : null,
  filter_action: record.filter.filterAction,
  keywords: record.keywords.map(getMastodonFilterKeyword),
  statuses: record.statuses.map(getMastodonFilterStatus)
})

const loadFilterRecord = async (
  database: Database,
  filter: DomainFilter
): Promise<ActiveFilterRecord> => {
  const [keywords, statuses] = await Promise.all([
    database.getFilterKeywords({
      actorId: filter.actorId,
      filterId: filter.id
    }),
    database.getFilterStatuses({
      actorId: filter.actorId,
      filterId: filter.id
    })
  ])
  return {
    filter,
    keywords: keywords ?? [],
    statuses: statuses ?? []
  }
}

export const getMastodonFilter = async (
  database: Database,
  filter: DomainFilter
): Promise<Mastodon.Filter> => {
  const record = await loadFilterRecord(database, filter)
  return buildMastodonFilter(record)
}

export const getMastodonFilters = async (
  database: Database,
  filters: DomainFilter[]
): Promise<Mastodon.Filter[]> => {
  if (filters.length === 0) return []
  const records = await Promise.all(
    filters.map((filter) => loadFilterRecord(database, filter))
  )
  return records.map(buildMastodonFilter)
}

export const getMastodonFilterFromRecord = (
  record: ActiveFilterRecord
): Mastodon.Filter => buildMastodonFilter(record)
