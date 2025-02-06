import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'

import { getWebfingerSelf } from './getWebfingerSelf'

enableFetchMocks()

describe('#getWebfingerSelf', () => {
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
})
