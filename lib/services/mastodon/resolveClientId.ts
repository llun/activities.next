import { Database } from '@/lib/database/types'
import { isPublicId } from '@/lib/utils/publicId'
import { idToUrl } from '@/lib/utils/urlToId'

// Accept-old resolver: translates any client-supplied id form (raw URI,
// UUIDv7 publicId, colon form, apurl_ opaque form) into the stored AP URI.
// Raw URLs pass through FIRST — idToUrl mangles scheme-prefixed input
// (https://a/b → https:////a/b), so it must never see one; this mirrors
// safeIdToUrl's own raw-URL early return. An unknown publicId is returned
// unchanged so it matches nothing downstream — the same 404/empty-page
// behavior legacy garbage input produces today.
const RAW_URL_PATTERN = /^https?:\/\//

// isPublicId accepts either case, and generatePublicId only ever stores
// lowercase, so an uppercased publicId is the same id — but whether the DATABASE
// agrees is a collation question: SQLite and PostgreSQL compare `publicId = ?`
// case sensitively, MySQL's default utf8mb4_0900_ai_ci does not. Left alone, the
// same id resolved on one backend and not another, and the single-id and batch
// resolvers could disagree with each other on the same input. Normalizing the
// PARAMETER (never the column, which would defeat the index) settles it the same
// way everywhere, for both resolvers. The fallback still returns the param as the
// client wrote it, so unknown input passes through untouched as before.
const toPublicIdLookupKey = (param: string) => param.toLowerCase()

export const resolveStatusIdParam = async (
  database: Pick<Database, 'getStatusIdByPublicId'>,
  param: string
): Promise<string> => {
  if (RAW_URL_PATTERN.test(param)) return param
  if (isPublicId(param)) {
    return (
      (await database.getStatusIdByPublicId({
        publicId: toPublicIdLookupKey(param)
      })) ?? param
    )
  }
  return idToUrl(param)
}

export const resolveActorIdParam = async (
  database: Pick<Database, 'getActorIdByPublicId'>,
  param: string
): Promise<string> => {
  if (RAW_URL_PATTERN.test(param)) return param
  if (isPublicId(param)) {
    return (
      (await database.getActorIdByPublicId({
        publicId: toPublicIdLookupKey(param)
      })) ?? param
    )
  }
  return idToUrl(param)
}

// Array form of the resolvers above, for the batch/bulk endpoints that accept
// `id[]`-style lists. Semantics per element are IDENTICAL to the single-id
// resolver — the only difference is that every publicId-shaped entry is looked
// up in ONE query instead of one query per id. Before this existed, a call site
// that used to be a pure-synchronous `ids.map(idToUrl)` became N point queries
// fired concurrently at a pool of 10.
//
// The result preserves input order, length, and duplicates so callers can zip
// it back against their own input array.
//
// The lookup returns a map keyed by the publicId the DATABASE holds, not by the
// string the client sent, so the map is keyed and read through
// toPublicIdLookupKey as well — otherwise a case-insensitive collation could
// return a row whose key no longer matched the param that asked for it, and the
// batch resolver would hand back the bare UUID for an id the single-id resolver
// resolved.
const resolveIdParams = async (
  params: string[],
  lookupPublicIds: (publicIds: string[]) => Promise<Map<string, string>>
): Promise<string[]> => {
  const publicIds = [
    ...new Set(
      params
        .filter((param) => !RAW_URL_PATTERN.test(param) && isPublicId(param))
        .map(toPublicIdLookupKey)
    )
  ]
  const resolvedByPublicId = new Map<string, string>()
  if (publicIds.length > 0) {
    for (const [publicId, id] of await lookupPublicIds(publicIds)) {
      resolvedByPublicId.set(toPublicIdLookupKey(publicId), id)
    }
  }

  return params.map((param) => {
    if (RAW_URL_PATTERN.test(param)) return param
    if (isPublicId(param)) {
      return resolvedByPublicId.get(toPublicIdLookupKey(param)) ?? param
    }
    return idToUrl(param)
  })
}

export const resolveStatusIdParams = (
  database: Pick<Database, 'getStatusIdsByPublicIds'>,
  params: string[]
): Promise<string[]> =>
  resolveIdParams(params, (publicIds) =>
    database.getStatusIdsByPublicIds({ publicIds })
  )

export const resolveActorIdParams = (
  database: Pick<Database, 'getActorIdsByPublicIds'>,
  params: string[]
): Promise<string[]> =>
  resolveIdParams(params, (publicIds) =>
    database.getActorIdsByPublicIds({ publicIds })
  )
