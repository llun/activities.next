import type { DirectConversation } from '@/lib/types/database/operations'
import { type Status, StatusType } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import Page from './page'

const mockGetConfig = jest.fn()
const mockGetDatabase = jest.fn()
const mockGetServerAuthSession = jest.fn()
const mockGetActorFromSession = jest.fn()

jest.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

jest.mock('./MessagesPage', () => ({
  MessagesPage: () => null
}))

const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()
const currentActor = {
  id: 'https://example.com/users/me',
  username: 'me',
  domain: 'example.com',
  name: 'Me',
  followersUrl: 'https://example.com/users/me/followers',
  inboxUrl: 'https://example.com/users/me/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime,
  updatedAt: currentTime,
  publicKey: 'public-key'
}

const account = (name: string): MastodonAccount =>
  ({
    id: `https://example.com/users/${name}`,
    username: name,
    acct: `${name}@example.com`,
    url: `https://example.com/users/${name}`,
    display_name: name,
    avatar: '',
    avatar_static: '',
    header: '',
    header_static: ''
  }) as MastodonAccount

const status = (id: string): Status => ({
  id,
  actorId: currentActor.id,
  actor: currentActor,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: `https://example.com/statuses/${id}`,
  text: id,
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
})

const conversation = (
  id: string,
  participantActorIds: string[]
): DirectConversation => ({
  id,
  actorId: currentActor.id,
  conversationId: `conversation-${id}`,
  rootStatusId: `root-${id}`,
  participantActorIds,
  lastStatusId: `last-${id}`,
  lastStatus: status(`last-${id}`),
  lastStatusCreatedAt: currentTime,
  unread: false,
  readAt: currentTime,
  hiddenAt: null,
  createdAt: currentTime,
  updatedAt: currentTime
})

describe('messages page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetConfig.mockReturnValue({ host: 'example.com' })
    mockGetServerAuthSession.mockResolvedValue({ user: { id: 'account-1' } })
    mockGetActorFromSession.mockResolvedValue(currentActor)
  })

  it('hydrates participant accounts in bulk', async () => {
    const conversations = [
      conversation('first', [
        currentActor.id,
        'https://example.com/users/ada',
        'https://example.com/users/bea'
      ]),
      conversation('second', [currentActor.id, 'https://example.com/users/ada'])
    ]
    const accounts = [account('ada'), account('bea')]
    const database = {
      getActorSettings: jest.fn().mockResolvedValue({ postLineLimit: 10 }),
      getDirectConversations: jest.fn().mockResolvedValue(conversations),
      getDirectConversationStatuses: jest.fn().mockResolvedValue([]),
      getMastodonActorsFromIds: jest.fn().mockResolvedValue(accounts),
      getMastodonActorFromId: jest.fn().mockResolvedValue(null)
    }
    mockGetDatabase.mockReturnValue(database)

    const element = await Page()

    expect(database.getMastodonActorsFromIds).toHaveBeenCalledTimes(1)
    expect(database.getMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://example.com/users/ada', 'https://example.com/users/bea']
    })
    expect(database.getMastodonActorFromId).not.toHaveBeenCalled()
    expect(element).toMatchObject({
      props: {
        conversations: [{ accounts }, { accounts: [accounts[0]] }]
      }
    })
  })

  it('sets the initial older-status cursor only when an extra status row exists', async () => {
    const conversations = [
      conversation('first', [currentActor.id, 'https://example.com/users/ada'])
    ]
    const initialStatusPage = Array.from({ length: 41 }, (_, index) =>
      status(`status-${index}`)
    )
    const database = {
      getActorSettings: jest.fn().mockResolvedValue({ postLineLimit: 10 }),
      getDirectConversations: jest.fn().mockResolvedValue(conversations),
      getDirectConversationStatuses: jest
        .fn()
        .mockResolvedValue(initialStatusPage),
      getMastodonActorsFromIds: jest.fn().mockResolvedValue([account('ada')]),
      getMastodonActorFromId: jest.fn().mockResolvedValue(null)
    }
    mockGetDatabase.mockReturnValue(database)

    const element = await Page()

    expect(database.getDirectConversationStatuses).toHaveBeenCalledWith({
      actorId: currentActor.id,
      conversationId: 'first',
      limit: 41
    })
    expect(element).toMatchObject({
      props: {
        initialStatuses: initialStatusPage.slice(0, 40),
        initialNextMaxStatusId: 'status-39'
      }
    })

    database.getDirectConversationStatuses.mockResolvedValueOnce(
      initialStatusPage.slice(0, 40)
    )

    const exactLimitElement = await Page()

    expect(exactLimitElement).toMatchObject({
      props: {
        initialStatuses: initialStatusPage.slice(0, 40),
        initialNextMaxStatusId: null
      }
    })
  })
})
