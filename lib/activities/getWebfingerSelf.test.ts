import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'

import { getWebfingerSelf } from './getWebfingerSelf'

enableFetchMocks()

describe('getWebfingerSelf', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns self href from the webfinger', async () => {
    const selfUrl = await getWebfingerSelf({ account: 'test1@llun.test' })
    expect(selfUrl).toEqual('https://llun.test/users/test1')
  })

  it('returns null for not found account', async () => {
    const selfUrl = await getWebfingerSelf({ account: 'notexist@llun.test' })
    expect(selfUrl).toBeNull()
  })

  it('does not request malformed account names', async () => {
    const selfUrl = await getWebfingerSelf({
      account: 'user@example.com@evil.test'
    })

    expect(selfUrl).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns self href from webfinger without aliases (Misskey format)', async () => {
    // Misskey doesn't include aliases in webfinger response
    fetchMock.mockResponseOnce(
      JSON.stringify({
        subject: 'acct:user@misskey.test',
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: 'https://misskey.test/users/abc123'
          },
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: 'https://misskey.test/@user'
          }
        ]
      })
    )
    const selfUrl = await getWebfingerSelf({ account: 'user@misskey.test' })
    expect(selfUrl).toEqual('https://misskey.test/users/abc123')
  })

  it('requests a JRD response using an encoded acct resource', async () => {
    const selfUrl = await getWebfingerSelf({ account: 'test1@llun.test' })

    expect(selfUrl).toEqual('https://llun.test/users/test1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llun.test/.well-known/webfinger?resource=acct%3Atest1%40llun.test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/jrd+json, application/json'
        })
      })
    )
  })
})
