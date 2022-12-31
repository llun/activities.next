import { FetchMock } from 'jest-fetch-mock'

import { MockMastodonNote } from './note'
import { MockActivityPubPerson } from './person'
import { MockWebfinger } from './webfinger'

export const mockRequests = (fetchMock: FetchMock) => {
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/.well-known/webfinger') {
      const account =
        url.searchParams.get('resource')?.slice('acct:'.length) || ''
      const username = account.split('@').shift()
      const userUrl =
        url.hostname === 'somewhere.test'
          ? `https://${url.hostname}/actors/${username}`
          : `https://${url.hostname}/users/${username}`
      return {
        status: 200,
        body: JSON.stringify(
          MockWebfinger({
            account,
            userUrl
          })
        )
      }
    }
    if (url.pathname.startsWith('/statuses')) {
      return {
        status: 200,
        body: JSON.stringify(
          MockMastodonNote({
            content: 'This is status'
          })
        )
      }
    }

    if (
      url.pathname.startsWith('/actors') ||
      url.pathname.startsWith('/users')
    ) {
      return {
        status: 200,
        body: JSON.stringify(MockActivityPubPerson({ id: req.url }))
      }
    }

    return {
      status: 404,
      body: 'Not Found'
    }
  })
}
