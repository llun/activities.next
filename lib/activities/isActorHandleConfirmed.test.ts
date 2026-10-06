import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { JRD_JSON_HEADERS } from '@/lib/stub/activities'
import { MockWebfinger } from '@/lib/stub/webfinger'

import { isActorHandleConfirmed } from './isActorHandleConfirmed'

enableFetchMocks()

// Answers WebFinger at `host` for `account` with the given self link, and
// records which URL was asked.
const serveWebfinger = (account: string, self: string) => {
  fetchMock.resetMocks()
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    if (
      url.pathname !== '/.well-known/webfinger' ||
      url.searchParams.get('resource') !== `acct:${account}` ||
      url.host !== account.split('@')[1]
    ) {
      return { status: 404, body: 'Not Found' }
    }
    return {
      status: 200,
      headers: JRD_JSON_HEADERS,
      body: JSON.stringify(MockWebfinger({ account, userUrl: self }))
    }
  })
}

describe('isActorHandleConfirmed', () => {
  // The row stores `new URL(id).host`, port included, so the lookup must go
  // to that same host:port and name it in the account.
  it('asks the actor host with its port', async () => {
    const actorId = 'https://remote.test:8443/users/alice'
    serveWebfinger('alice@remote.test:8443', actorId)

    await expect(
      isActorHandleConfirmed({ actorId, username: 'alice' })
    ).resolves.toBe(true)
  })

  // URL serialization noise (host case, a default port) is not a different
  // actor.
  it('matches a self link that differs only in host case', async () => {
    const actorId = 'https://remote.test/users/alice'
    serveWebfinger('alice@remote.test', 'https://REMOTE.test/users/alice')

    await expect(
      isActorHandleConfirmed({ actorId, username: 'alice' })
    ).resolves.toBe(true)
  })

  it('refuses a self link naming another actor', async () => {
    serveWebfinger('alice@remote.test', 'https://remote.test/users/mallory')

    await expect(
      isActorHandleConfirmed({
        actorId: 'https://remote.test/users/alice',
        username: 'alice'
      })
    ).resolves.toBe(false)
  })

  it.each(['not a url', 'urn:uuid:1234', ''])(
    'refuses an actor id with no host (%s) without fetching',
    async (actorId) => {
      fetchMock.resetMocks()

      await expect(
        isActorHandleConfirmed({ actorId, username: 'alice' })
      ).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})
