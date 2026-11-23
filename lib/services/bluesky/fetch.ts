import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

// Statuses whose Response must have a null body.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

// A WHATWG `fetch` for the atproto libraries (OAuth, DID and handle
// resolution, PDS calls) that sends every request through `safeRemoteFetch`:
// HTTPS only, public addresses only, DNS pinning, time and size limits. The
// libraries ask for `redirect: 'error'` or `'manual'` where the answer must
// come from the host they asked (metadata, DID documents, tokens), so those
// requests follow no redirect; `safeRemoteFetch` throws on one instead.
export const blueskyFetch = async (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const request = new Request(input, init)
  const method = request.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await request.text()
  const result = await safeRemoteFetch({
    url: request.url,
    method: method as 'GET',
    headers: Object.fromEntries(request.headers),
    ...(body !== undefined ? { body } : {}),
    maxRedirects: request.redirect === 'follow' ? undefined : 0,
    allowCrossHostRedirects: false,
    signal: request.signal
  })
  const headers = new Headers()
  for (const [name, value] of Object.entries(result.headers)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item)
    }
  }
  return new Response(
    NULL_BODY_STATUSES.has(result.statusCode) || method === 'HEAD'
      ? null
      : result.body,
    { status: result.statusCode, headers }
  )
}
