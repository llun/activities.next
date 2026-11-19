// A remote or user-supplied URL as logs and spans record it: its scheme and
// host only, capped. Userinfo, a query or a fragment can carry a token, and so
// can a path (a pasted share link looked up as an actor). Anything but an
// http(s) URL → null rather than the raw text: an opaque URI's path is its
// payload (`data:`), or another URL with userinfo (`blob:`).
export const toLoggableUrl = (value: string | undefined | null) => {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.protocol}//${url.host}`.slice(0, 512)
  } catch {
    return null
  }
}
