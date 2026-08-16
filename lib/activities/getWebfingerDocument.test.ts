import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
import { MockWebfinger } from '@/lib/stub/webfinger'

import {
  getWebfingerDocument,
  getWebfingerSubscribeTemplate
} from './getWebfingerDocument'

enableFetchMocks()

describe('getWebfingerDocument', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns the whole document including links', async () => {
    const document = await getWebfingerDocument({ account: 'test1@llun.test' })

    expect(document?.subject).toEqual('acct:test1@llun.test')
    expect(document?.links).toContainEqual(
      expect.objectContaining({
        rel: 'self',
        href: 'https://llun.test/users/test1'
      })
    )
  })

  it('requests a JRD response using an encoded acct resource', async () => {
    await getWebfingerDocument({ account: 'test1@llun.test' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://llun.test/.well-known/webfinger?resource=acct%3Atest1%40llun.test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/jrd+json, application/json'
        })
      })
    )
  })

  it('returns null for a not found account', async () => {
    expect(
      await getWebfingerDocument({ account: 'notexist@llun.test' })
    ).toBeNull()
  })

  it('returns null for malformed json', async () => {
    fetchMock.resetMocks()
    fetchMock.mockResponseOnce('not json at all')

    expect(
      await getWebfingerDocument({ account: 'user@remote.test' })
    ).toBeNull()
  })

  it('returns null when the document does not match the schema', async () => {
    fetchMock.resetMocks()
    fetchMock.mockResponseOnce(JSON.stringify({ unexpected: true }))

    expect(
      await getWebfingerDocument({ account: 'user@remote.test' })
    ).toBeNull()
  })

  it('does not request malformed account names', async () => {
    const document = await getWebfingerDocument({
      account: 'user@example.com@evil.test'
    })

    expect(document).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getWebfingerSubscribeTemplate', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('returns the advertised subscribe template', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(
        MockWebfinger({
          account: 'user@remote.test',
          includeSubscribeLink: true
        })
      )
    )

    expect(
      await getWebfingerSubscribeTemplate({ account: 'user@remote.test' })
    ).toEqual('https://remote.test/authorize_interaction?uri={uri}')
  })

  it('returns null when the server advertises no subscribe rel', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(MockWebfinger({ account: 'user@remote.test' }))
    )

    expect(
      await getWebfingerSubscribeTemplate({ account: 'user@remote.test' })
    ).toBeNull()
  })

  it('returns null when the subscribe link carries no template', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(
        MockWebfinger({
          account: 'user@remote.test',
          links: [
            {
              rel: 'http://ostatus.org/schema/1.0/subscribe',
              href: 'https://remote.test/authorize_interaction'
            }
          ]
        })
      )
    )

    expect(
      await getWebfingerSubscribeTemplate({ account: 'user@remote.test' })
    ).toBeNull()
  })

  it('returns null when the lookup fails', async () => {
    fetchMock.mockResponseOnce('', { status: 500 })

    expect(
      await getWebfingerSubscribeTemplate({ account: 'user@remote.test' })
    ).toBeNull()
  })
})
