import fetchMock from 'jest-fetch-mock'

import { ACTIVITY_JSON_HEADERS, JRD_JSON_HEADERS } from './activities'

export type FederationRoute = string | { body: string; contentType: string }
export type WebfingerAnswer = string | { self: string[]; subject: string }

// Serves a fixed set of ActivityPub documents plus the WebFinger answers that
// confirm their handles. Each route is served as `application/activity+json`
// unless it names its own type. `webfinger` maps `user@host` to the `self`
// link(s) that host's WebFinger answers with; an account it does not name is a
// 404, so a test confirms exactly the handles it lists. `signedOnly` models an
// authorized-fetch (secure-mode) origin: it answers 401 to any ActivityPub
// request that carries no signature (WebFinger stays public, as on Mastodon).
export const serveFederationRoutes = (
  routes: Record<string, FederationRoute>,
  {
    signedOnly = false,
    webfinger = {}
  }: { signedOnly?: boolean; webfinger?: Record<string, WebfingerAnswer> } = {}
) => {
  fetchMock.resetMocks()
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/.well-known/webfinger') {
      const resource = url.searchParams.get('resource') ?? ''
      const answer = webfinger[resource.replace(/^acct:/, '')]
      if (!answer) return { status: 404, body: 'Not Found' }
      const { self, subject } =
        typeof answer === 'string'
          ? { self: [answer], subject: resource }
          : answer
      return {
        status: 200,
        headers: JRD_JSON_HEADERS,
        body: JSON.stringify({
          subject,
          links: self.map((href) => ({
            rel: 'self',
            type: 'application/activity+json',
            href
          }))
        })
      }
    }
    if (signedOnly && !req.headers.get('signature')) {
      return { status: 401, body: 'Unauthorized' }
    }
    const route = routes[req.url]
    if (!route) return { status: 404, body: 'Not Found' }
    if (typeof route === 'string') {
      return { status: 200, headers: ACTIVITY_JSON_HEADERS, body: route }
    }
    return {
      status: 200,
      headers: { 'content-type': route.contentType },
      body: route.body
    }
  })
}
