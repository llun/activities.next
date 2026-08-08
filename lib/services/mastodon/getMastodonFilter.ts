import { Database } from '@/lib/database/types'
import {
  ActiveFilterRecord,
  ActiveServerFilterRecord
} from '@/lib/types/database/operations'
import {
  Filter as DomainFilter,
  FilterKeyword as DomainFilterKeyword,
  FilterStatus as DomainFilterStatus,
  ServerFilter as DomainServerFilter
} from '@/lib/types/domain/filter'
import * as Mastodon from '@/lib/types/mastodon'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

export const getMastodonFilterKeyword = (
  keyword: DomainFilterKeyword
): Mastodon.FilterKeyword => ({
  id: keyword.id,
  keyword: keyword.keyword,
  whole_word: keyword.wholeWord
})

// `filter_statuses.statusId` usually holds the RESOLVED status URI — POST
// /api/v2/filters/:id/statuses resolves whatever id form the client sent so
// matching can work — but the API emits the legacy colon-form id everywhere
// else, so a stored URI is converted here at the emission boundary. Without it a
// client that posted the id it read off the timeline gets a raw
// `https://…/statuses/…` back, cannot compare it to the status id it holds, and
// breaks if it interpolates the value into a URL; a list would also mix both
// forms depending on when each row was written.
//
// Only URIs are converted, because a URI is not the only thing the column can
// hold and `urlToId` is not identity on the rest: it leaves a colon-form or
// `apurl_` id alone (for a status URI the invalid `:users` "port" makes
// `new URL` throw and the input comes back unchanged) but turns a BARE publicId
// into `<uuid>:`. The route stores an unresolvable publicId unchanged and the
// table has no foreign key, so such rows exist — and a spurious trailing colon
// on an id the client never wrote is exactly the mismatch this normalisation is
// meant to prevent. Testing for a URL rather than relying on idempotence keeps
// every other stored form byte-identical by construction.
export const toEmittedFilterStatusId = (statusId: string): string =>
  /^https?:\/\//.test(statusId) ? urlToId(statusId) : statusId

export const getMastodonFilterStatus = (
  status: DomainFilterStatus
): Mastodon.FilterStatus => ({
  id: status.id,
  status_id: toEmittedFilterStatusId(status.statusId)
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

// ----------------------------------------------------------------------------
// Server (instance-wide) filters.
//
// Returned to clients merged into the account filter list, flagged read-only
// via the non-standard `server: true` field. Third-party Mastodon clients
// ignore the unknown field and apply the filter natively; first-party clients
// use it to hide edit/delete affordances. Server filters are keyword-only, so
// `statuses` is always empty.
// ----------------------------------------------------------------------------

export type MastodonServerFilter = Mastodon.Filter & { server: true }

const buildMastodonServerFilter = (
  filter: DomainServerFilter,
  keywords: DomainFilterKeyword[]
): MastodonServerFilter => ({
  id: filter.id,
  title: filter.title,
  context: filter.context,
  expires_at:
    filter.expiresAt !== null ? getISOTimeUTC(filter.expiresAt) : null,
  filter_action: filter.filterAction,
  keywords: keywords.map(getMastodonFilterKeyword),
  statuses: [],
  server: true
})

export const getMastodonServerFilterFromRecord = (
  record: ActiveServerFilterRecord
): MastodonServerFilter =>
  buildMastodonServerFilter(record.filter, record.keywords)

export const getMastodonServerFilter = async (
  database: Database,
  filter: DomainServerFilter
): Promise<MastodonServerFilter> => {
  const keywords = await database.getServerFilterKeywords({ id: filter.id })
  return buildMastodonServerFilter(filter, keywords ?? [])
}

// ----------------------------------------------------------------------------
// Deprecated v1 filter view.
//
// The v1 API predates multi-keyword filters: each row a v1 client sees is one
// KEYWORD of a v2 filter, addressed by the keyword id. `phrase`/`whole_word`
// come from the keyword; `context`/`expires_at` from the parent filter; and
// `irreversible` maps to the parent's `filter_action === 'hide'`.
// ----------------------------------------------------------------------------

export const getV1Filter = (
  filter: Pick<DomainFilter, 'context' | 'expiresAt' | 'filterAction'>,
  keyword: DomainFilterKeyword
): Mastodon.V1Filter => ({
  id: keyword.id,
  phrase: keyword.keyword,
  context: filter.context,
  expires_at:
    filter.expiresAt !== null ? getISOTimeUTC(filter.expiresAt) : null,
  irreversible: filter.filterAction === 'hide',
  whole_word: keyword.wholeWord
})
