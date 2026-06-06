interface PaginationLinkHeaderParams {
  host: string | null | undefined
  path: string
  limit: number
  nextMaxId?: string | null
  prevMinId?: string | null
}

/**
 * Builds the Mastodon-style `Link` header entry for cursor pagination. Each
 * caller decides when a `next`/`prev` cursor exists (e.g. full page vs any
 * results) and passes the cursor value or `null`. Returns an `additionalHeaders`
 * array ready for `apiResponse` — empty when there is no host or no cursors.
 */
export const buildPaginationLinkHeader = ({
  host,
  path,
  limit,
  nextMaxId,
  prevMinId
}: PaginationLinkHeaderParams): [string, string][] => {
  if (!host) return []

  const buildLink = (cursor: 'max_id' | 'min_id', value: string) => {
    const params = new URLSearchParams()
    params.set('limit', `${limit}`)
    params.set(cursor, value)
    return `<https://${host}${path}?${params.toString()}>; rel="${
      cursor === 'max_id' ? 'next' : 'prev'
    }"`
  }

  const links = [
    nextMaxId ? buildLink('max_id', nextMaxId) : null,
    prevMinId ? buildLink('min_id', prevMinId) : null
  ].filter((link): link is string => Boolean(link))

  return links.length > 0 ? [['Link', links.join(', ')]] : []
}
