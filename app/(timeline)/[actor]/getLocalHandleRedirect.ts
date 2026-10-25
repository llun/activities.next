import type { Actor } from '@/lib/types/domain/actor'
import { isCurrentHandle, parseAccountHandle } from '@/lib/utils/accountHandle'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'

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

// The header path's first segment must be the requested handle itself,
// case-folded. The proxy always sets the header to the request's own
// pathname, so a mismatch means the value did not come from the rewrite
// this helper exists for; honouring it would 308 an attacker-chosen
// same-origin path. A bare segment (`/@alice`, forwarded for the rewritten
// `@alice@host`) matches its handle's username; a qualified segment must
// also match the domain.
const matchesRequestedHandle = (
  pathSegment: string,
  requestedHandle: string
) => {
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const segment = decode(pathSegment).replace(/^@/, '').toLowerCase()
  const requested = decode(requestedHandle).replace(/^@/, '').toLowerCase()
  if (segment === requested) return true
  const [segmentUsername, segmentDomain] = segment.split('@')
  const [requestedUsername, requestedDomain] = requested.split('@')
  if (segmentUsername !== requestedUsername) return false
  // A bare segment carries no domain: the proxy appended the host to the
  // rewritten URL, not to the captured path.
  return segmentDomain === undefined && requestedDomain !== undefined
}

/**
 * Return the current local profile path for a historical handle, preserving
 * the nested path and query captured from the incoming request. The captured
 * path must belong to the requested handle (its first segment, case-folded)
 * and must not climb with `..`.
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

  const segments = pathname.split('/')
  const firstSegment = segments[1] ?? ''
  if (
    segments.some((segment) => segment === '..') ||
    !matchesRequestedHandle(firstSegment, requestedHandle)
  ) {
    return null
  }

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
