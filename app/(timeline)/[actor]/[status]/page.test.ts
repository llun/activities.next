import { generateMetadata } from './page'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('./Header', () => ({
  Header: () => null
}))

vi.mock('./RemoteStatusLoading', () => ({
  RemoteStatusLoading: () => null
}))

vi.mock('./StatusBox', () => ({
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
