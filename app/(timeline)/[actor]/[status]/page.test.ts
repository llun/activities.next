import { generateMetadata } from './page'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

jest.mock('./Header', () => ({
  Header: () => null
}))

jest.mock('./RemoteStatusLoading', () => ({
  RemoteStatusLoading: () => null
}))

jest.mock('./StatusBox', () => ({
  StatusBox: () => null
}))

describe('generateMetadata', () => {
  it('does not throw when the actor route has malformed URI escapes', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({
          actor: '%E0%A4%A',
          status: 'status-id'
        })
      })
    ).resolves.toEqual({
      title: 'Activities.next: %E0%A4%A status'
    })
  })
})
