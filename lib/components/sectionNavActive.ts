// Shared by the section dropdown and the section rail. Dependency-free and
// without `'use client'` so either side of the server/client boundary can read
// it.

/**
 * The most specific url that is the path or a parent of it, so
 * `/account/security/...` resolves to Security, not to `/account`. Undefined
 * when nothing matches.
 */
export const resolveActiveSectionUrl = (
  pathname: string,
  urls: readonly string[]
): string | undefined =>
  urls
    .filter((url) => pathname === url || pathname.startsWith(`${url}/`))
    .sort((a, b) => b.length - a.length)[0]
