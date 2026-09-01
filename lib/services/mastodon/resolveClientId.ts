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

export const resolveStatusIdParam = async (
  database: Pick<Database, 'getStatusIdByPublicId'>,
  param: string
): Promise<string> => {
  if (RAW_URL_PATTERN.test(param)) return param
  if (isPublicId(param)) {
    return (await database.getStatusIdByPublicId({ publicId: param })) ?? param
  }
  return idToUrl(param)
}

export const resolveActorIdParam = async (
  database: Pick<Database, 'getActorIdByPublicId'>,
  param: string
): Promise<string> => {
  if (RAW_URL_PATTERN.test(param)) return param
  if (isPublicId(param)) {
    return (await database.getActorIdByPublicId({ publicId: param })) ?? param
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
// Case handling lives in the database layer, which normalizes the lookup
// parameter and keys the returned map by the publicIds as REQUESTED — so a
// param is read back with exactly the string it was sent as, whatever collation
// the backend uses.
const resolveIdParams = async (
  params: string[],
  lookupPublicIds: (publicIds: string[]) => Promise<Map<string, string>>
): Promise<string[]> => {
  const publicIds = [
    ...new Set(
      params.filter(
        (param) => !RAW_URL_PATTERN.test(param) && isPublicId(param)
      )
    )
  ]
  const resolvedByPublicId =
    publicIds.length > 0
      ? await lookupPublicIds(publicIds)
      : new Map<string, string>()

  return params.map((param) => {
    if (RAW_URL_PATTERN.test(param)) return param
    if (isPublicId(param)) return resolvedByPublicId.get(param) ?? param
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

// A resolved id is only usable where an actor AP URI is required. The
// resolvers above return an unknown publicId UNCHANGED (their documented
// "matches nothing" contract), and `idToUrl` is permissive enough to emit an
// unparseable string, so a resolved list can hold values that are not URIs at
// all. Callers that persist a resolved id or feed it to `new URL` filter the
// OUTPUT of the resolvers through this — it never prunes an input form the
// resolvers accept.
export const isResolvedActorUri = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
