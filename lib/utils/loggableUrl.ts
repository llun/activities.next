// A remote or user-supplied URL as logs and spans record it: scheme, host and
// path only, capped, because userinfo, a query or a fragment can carry a token.
// Not a URL at all → null rather than the raw text.
export const toLoggableUrl = (value: string | undefined | null) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 512)
  } catch {
    return null
  }
}
