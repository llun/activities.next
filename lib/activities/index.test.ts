import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getWebfingerSelf } from '.'
import { MockWebfinger } from '../stub/webfinger'

enableFetchMocks()

describe('#getWebfingerSelf', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('returns self href from the webfinger', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(MockWebfinger({ account: 'null@llun.dev' }))
    )

    const selfUrl = await getWebfingerSelf('null@llun.dev')
    expect(selfUrl).toEqual('https://llun.dev/users/null')
  })

  it('returns null for invalid account', async () => {
    const selfUrl = await getWebfingerSelf('null')
    expect(selfUrl).toBeNull()
  })

  it('returns null for not found account', async () => {
    fetchMock.mockResponseOnce('Not Found', {
      status: 404
    })

    const selfUrl = await getWebfingerSelf('null@llun.dev')
    expect(selfUrl).toBeNull()
  })
})
