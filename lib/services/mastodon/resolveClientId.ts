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
