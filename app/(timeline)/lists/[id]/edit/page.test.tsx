import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import Page from './page'

const mockGetDatabase = vi.fn()
const mockGetServerAuthSession = vi.fn()
const mockGetActorFromSession = vi.fn()

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'example.com' })
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

vi.mock('@/app/(timeline)/lists/ListEditor', () => ({
  ListEditor: () => null
}))

const actor = { id: 'https://example.com/users/me' }

// A Mastodon Account's `id` is the actor's publicId, not its ActivityPub URI —
// deliberately different from `actor.id` here, so building the owner entry
// from the domain actor instead of the serialized account would be caught.
const ownAccount = {
  id: '0190c2f4-7c1e-7e4a-9b6a-2f7d3c1e5a01',
  username: 'me',
  acct: 'me',
  url: actor.id,
  display_name: 'Mai',
  avatar: 'https://example.com/avatars/me.png'
} as MastodonAccount

const ownEntry = {
  id: ownAccount.id,
  name: 'Mai',
  handle: 'me@example.com',
  avatar: ownAccount.avatar
}

describe('list edit page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue({})
    mockGetActorFromSession.mockResolvedValue(actor)
  })

  it('passes the owner account with the same id as their member entry', async () => {
    const database = {
      getList: vi.fn().mockResolvedValue({
        id: 'list-1',
        actorId: actor.id,
        title: 'Running club',
        repliesPolicy: 'list',
        exclusive: false,
        createdAt: 0,
        updatedAt: 0
      }),
      getListAccounts: vi.fn().mockResolvedValue({
        accounts: [ownAccount],
        nextMaxId: null,
        prevMinId: null
      }),
      getFollowing: vi.fn().mockResolvedValue([]),
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([]),
      getMastodonActorFromId: vi.fn().mockResolvedValue(ownAccount)
    }
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ params: Promise.resolve({ id: 'list-1' }) })

    expect(database.getMastodonActorFromId).toHaveBeenCalledWith({
      id: actor.id
    })
    expect(element).toMatchObject({
      props: { currentAccount: ownEntry, initialMembers: [ownEntry] }
    })
  })
})
