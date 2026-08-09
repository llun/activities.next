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
import { isPublicId } from '@/lib/utils/publicId'
import { safeIdToUrl, urlToId } from '@/lib/utils/urlToId'

export const getMastodonFilterKeyword = (
  keyword: DomainFilterKeyword
): Mastodon.FilterKeyword => ({
  id: keyword.id,
  keyword: keyword.keyword,
  whole_word: keyword.wholeWord
})

// LAST-RESORT emission for a `filter_statuses` row whose status has no publicId
// to emit: a row written before the backfill, or one pointing at a status this
// instance does not have (the column has no foreign key). Everything else emits
// the publicId every other status reference in the API now carries — see
// hydrateFilterStatusPublicIds — so this only decides what a row that cannot
// reach one looks like, and there the pre-flip legacy colon form is the answer
// the accept side still resolves.
//
// `filter_statuses.statusId` usually holds the RESOLVED status URI — POST
// /api/v2/filters/:id/statuses resolves whatever id form the client sent so
// matching can work — and a raw `https://…/statuses/…` is an id form the API
// never emits: a client cannot compare it against the status ids it holds and
// breaks if it interpolates the value into a URL.
//
// Only URIs are converted, because a URI is not the only thing the column can
// hold and `urlToId` is not identity on the rest: it leaves a colon-form or
// `apurl_` id alone (for a status URI the invalid `:users` "port" makes
// `new URL` throw and the input comes back unchanged) but turns a BARE publicId
// into `<uuid>:`. The route stores an unresolvable publicId unchanged, so such
// rows exist — and a spurious trailing colon on an id the client never wrote is
// exactly the mismatch this normalisation is meant to prevent. Testing for a URL
// rather than relying on idempotence keeps every other stored form
// byte-identical by construction.
export const toEmittedFilterStatusId = (statusId: string): string =>
  /^https?:\/\//.test(statusId) ? urlToId(statusId) : statusId

// A `filter_statuses` row hydrated with the publicId of the status it points at,
// or null when there is none to emit. The stored `statusId` is deliberately left
// exactly as written: matching compares against it, and it is the only value
// that can still identify a row stored in a legacy form.
export type FilterStatusWithPublicId = DomainFilterStatus & {
  statusPublicId: string | null
}

// A filter record whose `filter_statuses` rows have been through
// hydrateFilterRecordStatusPublicIds. The property is REQUIRED rather than
// optional so an un-hydrated record cannot be handed to an emission or matching
// entry point: a filter that reports an id no other part of the response uses is
// invisible in normal use, so the compiler is the only thing that reliably
// catches it.
export type FilterRecordWithStatusPublicIds = Omit<
  ActiveFilterRecord,
  'statuses'
> & { statuses: FilterStatusWithPublicId[] }

// Best-effort lookup key: the ActivityPub URI a stored value names — the key
// `statuses.id` is indexed by — or null when the row cannot name one. A bare
// publicId is skipped on purpose: `idToUrl` would turn it into the junk lookup
// key `https://<uuid>/`, and such a row already holds the emitted form, so
// toEmittedFilterStatusId returns it unchanged.
//
// This is best-effort because `urlToId` is LOSSY — it drops the scheme and
// normalizes the host — so `idToUrl(urlToId(id))` is not the identity for every
// `statuses.id`. A remote note delivered to the inbox keeps whatever `note.id`
// the sender wrote (createNoteJob stores it verbatim), so an uppercase host or
// an explicit `:443` survives, and a row holding the colon form of one rebuilds
// a URI no row is keyed by. The lookup then misses and the row emits the legacy
// colon form. That is a WORSE id, not an inconsistent one: every emission point
// reads the same hydrated value through getEmittedFilterStatusId, so a miss
// makes them fall back together.
const toStoredStatusUri = (statusId: string): string | null =>
  isPublicId(statusId) ? null : safeIdToUrl(statusId)

// Resolves the publicId of every `filter_statuses` row in ONE query, so a filter
// list costs one lookup instead of one per row — and so the emission stays
// synchronous downstream, where the matching pipeline runs.
export const hydrateFilterStatusPublicIds = async (
  database: Pick<Database, 'getStatusPublicIds'>,
  filterStatuses: DomainFilterStatus[]
): Promise<FilterStatusWithPublicId[]> => {
  const uriByStoredId = new Map<string, string>()
  for (const { statusId } of filterStatuses) {
    if (uriByStoredId.has(statusId)) continue
    const uri = toStoredStatusUri(statusId)
    if (uri) uriByStoredId.set(statusId, uri)
  }
  if (uriByStoredId.size === 0) {
    return filterStatuses.map((status) => ({ ...status, statusPublicId: null }))
  }

  const publicIdByUri = await database.getStatusPublicIds({
    statusIds: [...new Set(uriByStoredId.values())]
  })
  return filterStatuses.map((status) => {
    const uri = uriByStoredId.get(status.statusId)
    return {
      ...status,
      statusPublicId: (uri && publicIdByUri.get(uri)) ?? null
    }
  })
}

// Record-level form of hydrateFilterStatusPublicIds: every row across every
// record resolves in the same single query.
export const hydrateFilterRecordStatusPublicIds = async (
  database: Pick<Database, 'getStatusPublicIds'>,
  records: ActiveFilterRecord[]
): Promise<FilterRecordWithStatusPublicIds[]> => {
  const hydratedStatuses = await hydrateFilterStatusPublicIds(
    database,
    records.flatMap((record) => record.statuses)
  )
  let offset = 0
  return records.map((record) => {
    const statuses = hydratedStatuses.slice(
      offset,
      offset + record.statuses.length
    )
    offset += record.statuses.length
    return { ...record, statuses }
  })
}

// THE single rule for naming the status a `filter_statuses` row points at, and
// the reason a response cannot name one status two ways. Both places a filter's
// status id leaves the API go through this, keyed on the same hydrated row:
// `filter.statuses[].status_id` here, and the `status_matches` of a
// FilterResult (see matchFilter in lib/services/filters/applyFilters). Neither
// reconstructs the id from anything else, so they resolve together and — when
// the hydration found nothing to resolve — fall back together.
export const getEmittedFilterStatusId = (
  status: FilterStatusWithPublicId
): string => status.statusPublicId ?? toEmittedFilterStatusId(status.statusId)

export const getMastodonFilterStatus = (
  status: FilterStatusWithPublicId
): Mastodon.FilterStatus => ({
  id: status.id,
  status_id: getEmittedFilterStatusId(status)
})

export const getMastodonFilterStatuses = async (
  database: Pick<Database, 'getStatusPublicIds'>,
  statuses: DomainFilterStatus[]
): Promise<Mastodon.FilterStatus[]> => {
  const hydrated = await hydrateFilterStatusPublicIds(database, statuses)
  return hydrated.map(getMastodonFilterStatus)
}

export const getMastodonFilterStatusWithPublicId = async (
  database: Pick<Database, 'getStatusPublicIds'>,
  status: DomainFilterStatus
): Promise<Mastodon.FilterStatus> => {
  const [hydrated] = await hydrateFilterStatusPublicIds(database, [status])
  return getMastodonFilterStatus(hydrated)
}

const buildMastodonFilter = (
  record: FilterRecordWithStatusPublicIds
): Mastodon.Filter => ({
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
  const [hydrated] = await hydrateFilterRecordStatusPublicIds(database, [
    record
  ])
  return buildMastodonFilter(hydrated)
}

export const getMastodonFilters = async (
  database: Database,
  filters: DomainFilter[]
): Promise<Mastodon.Filter[]> => {
  if (filters.length === 0) return []
  const records = await Promise.all(
    filters.map((filter) => loadFilterRecord(database, filter))
  )
  const hydrated = await hydrateFilterRecordStatusPublicIds(database, records)
  return hydrated.map(buildMastodonFilter)
}

export const getMastodonFilterFromRecord = (
  record: FilterRecordWithStatusPublicIds
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
