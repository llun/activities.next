import type { Actor } from '@/lib/types/domain/actor'
import { isCurrentHandle, parseAccountHandle } from '@/lib/utils/accountHandle'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'

export const LOCAL_HANDLE_REDIRECT_PATH_HEADER =
  'x-activities-local-handle-path'
export const LOCAL_HANDLE_REDIRECT_SEARCH_HEADER =
  'x-activities-local-handle-search'

interface GetLocalHandleRedirectParams {
  actor: Actor | null | undefined
  requestedHandle: string
  pathname: string | null | undefined
  search: string | null | undefined
}

const parseRequestedHandle = (value: string) => {
  try {
    return parseAccountHandle(decodeURIComponent(value))
  } catch {
    return null
  }
}

/**
 * Return the current local profile path for a historical handle, preserving
 * the nested path and query captured from the incoming request.
 */
export const getLocalHandleRedirect = ({
  actor,
  requestedHandle,
  pathname,
  search
}: GetLocalHandleRedirectParams): string | null => {
  if (!actor?.privateKey || !actor.account || !pathname?.startsWith('/')) {
    return null
  }

  const handle = parseRequestedHandle(requestedHandle)
  if (!handle || isCurrentHandle(actor, handle)) return null

  const pathSeparator = pathname.indexOf('/', 1)
  const nestedPath =
    pathSeparator >= 0
      ? pathname.slice(pathSeparator)
      : pathname.endsWith('/')
        ? '/'
        : ''
  const query = search ? (search.startsWith('?') ? search : `?${search}`) : ''

  return `/${getActorMentionPathSegment(actor)}${nestedPath}${query}`
}
