import { FetchMock } from 'jest-fetch-mock'

import { MockActivityPubFollowers } from './followers'
import { MockActivityPubFollowing } from './following'
import { MockImageDocument } from './imageDocument'
import { MockLitepubNote, MockMastodonActivityPubNote } from './note'
import { MockActivityPubOutbox } from './outbox'
import { MockActivityPubPerson } from './person'
import { MockWebfinger } from './webfinger'

export const mockRequests = (fetchMock: FetchMock) => {
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    if (req.method === 'GET') {
      if (url.pathname === '/.well-known/webfinger') {
        const account =
          url.searchParams.get('resource')?.slice('acct:'.length) || ''
        const username = account.split('@').shift()
        if (username === 'notexist') {
          return {
            status: 404
          }
        }

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

      if (url.pathname.includes('/inbox')) {
        return {
          status: 202,
          body: ''
        }
      }

      // llun.test domain
      if (url.pathname.includes('/statuses')) {
        const from = req.url.slice(0, req.url.indexOf('/statuses'))

        if (url.pathname.endsWith('-attachments')) {
          return {
            status: 200,
            body: JSON.stringify(
              MockMastodonActivityPubNote({
                id: req.url,
                from,
                content: 'This is status with attachments',
                withContext: true,
                documents: [
                  MockImageDocument({
                    url: 'https://llun.test/images/test1.jpg'
                  }),
                  MockImageDocument({
                    url: 'https://llun.test/images/test2.jpg',
                    name: 'Second image'
                  })
                ]
              })
            )
          }
        }

        return {
          status: 200,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: req.url,
              from,
              content: 'This is status',
              withContext: true
            })
          )
        }
      }

      // somewhere.test domain e.g. https://somewhere.test/actors/{username}/lp/{status-id}
      if (url.pathname.includes('/lp/')) {
        const from = req.url.slice(0, req.url.indexOf('/lp/'))
        return {
          status: 200,
          body: JSON.stringify(
            MockLitepubNote({
              id: req.url,
              from,
              content: 'This is litepub status',
              withContext: true
            })
          )
        }
      }

      // somewhere.test domain e.g. https://somewhere.test/s/{username}/{status-id}
      if (url.pathname.startsWith('/s')) {
        const [, username] = url.pathname.slice(1).split('/')
        return {
          status: 200,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: req.url,
              from: `https://${url.hostname}/actors/${username}`,
              content: 'This is status',
              withContext: true
            })
          )
        }
      }

      // Mock Person outbox
      if (
        url.pathname.startsWith('/users') &&
        url.pathname.includes('/outbox')
      ) {
        const [, username] = url.pathname.slice(1).split('/')
        if (url.searchParams.has('page')) {
          return {
            status: 200,
            body: JSON.stringify(
              MockActivityPubOutbox({
                actorId: `https://${url.hostname}/users/${username}`,
                withPage: true,
                withContext: true
              })
            )
          }
        }

        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubOutbox({
              actorId: `https://${url.hostname}/users/${username}`,
              withContext: true
            })
          )
        }
      }

      // Mock Person following
      if (
        url.pathname.startsWith('/users') &&
        url.pathname.includes('/following')
      ) {
        const [, username] = url.pathname.slice(1).split('/')
        if (url.searchParams.has('page')) {
          return {
            status: 200,
            body: JSON.stringify(
              MockActivityPubFollowing({
                actorId: `https://${url.hostname}/users/${username}`,
                withPage: true
              })
            )
          }
        }

        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubFollowing({
              actorId: `https://${url.hostname}/users/${username}`
            })
          )
        }
      }

      // Mock Person followers
      if (
        url.pathname.startsWith('/users') &&
        url.pathname.includes('/followers')
      ) {
        const [, username] = url.pathname.slice(1).split('/')
        if (url.searchParams.has('page')) {
          return {
            status: 200,
            body: JSON.stringify(
              MockActivityPubFollowers({
                actorId: `https://${url.hostname}/users/${username}`,
                withPage: true
              })
            )
          }
        }

        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubFollowers({
              actorId: `https://${url.hostname}/users/${username}`
            })
          )
        }
      }

      // Mock Person API
      if (url.pathname.startsWith('/users')) {
        return {
          status: 200,
          body: JSON.stringify(MockActivityPubPerson({ id: req.url }))
        }
      }
      if (url.pathname.startsWith('/actors')) {
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubPerson({ id: req.url, url: req.url })
          )
        }
      }

      return {
        status: 404,
        body: 'Not Found'
      }
    }

    if (req.method === 'POST') {
      if (url.pathname === '/inbox') {
        return {
          status: 200
        }
      }
    }

    return {
      status: 404
    }
  })
}

export const expectCall = (
  fetchMock: FetchMock,
  url: string,
  method: string,
  body: Record<string, unknown>
) => {
  const call = fetchMock.mock.calls.find((call) => call[0] === url)
  if (!call) fail(`${url} request must exist`)

  const request = call[1]
  const parsedBody = JSON.parse(request?.body as string)

  expect(call[0]).toEqual(url)
  expect(call[1]?.method).toEqual(method)
  expect(parsedBody).toMatchObject(body)
}
