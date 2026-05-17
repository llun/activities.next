import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetActorFromUsername = jest.fn()
const mockGetMastodonActorFromId = jest.fn()
const mockGetWebfingerSelf = jest.fn()
const mockRecordActorIfNeeded = jest.fn()
const mockGetServerSession = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: () => ({
    getActorFromUsername: mockGetActorFromUsername,
    getMastodonActorFromId: mockGetMastodonActorFromId
  })
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test' })
}))

jest.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: (...args: unknown[]) => mockGetWebfingerSelf(...args)
}))

jest.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: (...args: unknown[]) => mockRecordActorIfNeeded(...args)
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

describe('GET /api/v1/accounts/lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
  })

  it('uses the normalized username for @user local lookup', async () => {
    const actor = { id: 'https://llun.test/users/test1' }
    const account = { id: 'test1', username: 'test1', acct: 'test1' }
    mockGetActorFromUsername.mockResolvedValue(actor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/accounts/lookup?acct=@test1')
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromUsername).toHaveBeenCalledWith({
      username: 'test1',
      domain: 'llun.test'
    })
  })

  it('rejects handles with more than one username/domain separator', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=user@host@domain'
      )
    )

    expect(response.status).toBe(400)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })

  it('does not remotely resolve unauthenticated lookup requests', async () => {
    mockGetActorFromUsername.mockResolvedValue(null)
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/person')
    mockRecordActorIfNeeded.mockResolvedValue({
      id: 'https://remote.test/users/person'
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test&resolve=true'
      )
    )

    expect(response.status).toBe(404)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })
})
