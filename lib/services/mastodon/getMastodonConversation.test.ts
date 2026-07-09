import { Database } from '@/lib/database/types'
import {
  getMastodonConversation,
  getMastodonConversationAccountMap,
  getMastodonConversationAccounts,
  getMastodonConversations
} from '@/lib/services/mastodon/getMastodonConversation'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { Mastodon } from '@/lib/types/activitypub'
import { DirectConversation } from '@/lib/types/database/operations'
import { Status, StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: vi.fn().mockResolvedValue(null),
  getMastodonStatuses: vi.fn().mockResolvedValue([])
}))

const mastodonAccount = (actorId: string): Mastodon.Account => ({
  id: actorId,
  username: actorId.split('/').at(-1) ?? actorId,
  acct: actorId.split('/').at(-1) ?? actorId,
  url: actorId,
  uri: actorId,
  display_name: actorId,
  note: '',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {
    note: '',
    fields: [],
    privacy: 'public',
    sensitive: false,
    language: '',
    attribution_domains: [],
    follow_requests_count: 0
  },
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: null,
  noindex: null,
  roles: [],
  indexable: false,
  hide_collections: null,
  created_at: '2026-05-17T00:00:00.000Z',
  last_status_at: null,
  statuses_count: 0,
  followers_count: 0,
  following_count: 0
})

const status = (id: string, actorId = 'https://llun.test/users/alice') =>
  ({
    id,
    url: id,
    actorId,
    actor: null,
    type: StatusType.enum.Note,
    text: id,
    summary: null,
    reply: '',
    to: [],
    cc: [],
    edits: [],
    attachments: [],
    tags: [],
    replies: [],
    totalLikes: 0,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    isLocalActor: false,
    totalShares: 0,
    createdAt: Date.parse('2026-05-17T00:00:00.000Z'),
    updatedAt: Date.parse('2026-05-17T00:00:00.000Z')
  }) as Status

const mastodonStatus = (uri: string): Mastodon.Status => ({
  id: uri,
  uri,
  account: mastodonAccount('https://llun.test/users/alice'),
  content: '',
  visibility: 'direct',
  sensitive: false,
  spoiler_text: '',
  media_attachments: [],
  emojis: [],
  mentions: [],
  tags: [],
  reblogs_count: 0,
  favourites_count: 0,
  replies_count: 0,
  url: uri,
  in_reply_to_id: null,
  in_reply_to_account_id: null,
  poll: null,
  card: null,
  language: null,
  text: null,
  created_at: '2026-05-17T00:00:00.000Z',
  edited_at: null,
  favourited: false,
  reblogged: false,
  reblog: null
})

describe('getMastodonConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getMastodonStatuses as jest.Mock).mockResolvedValue([])
  })

  it('hydrates each non-current participant actor once across conversations', async () => {
    const accountByActorId = new Map<string, Mastodon.Account>([
      [
        'https://llun.test/users/alice',
        {
          id: '1',
          username: 'alice',
          url: 'https://llun.test/users/alice'
        } as Mastodon.Account
      ],
      [
        'https://llun.test/users/bob',
        {
          id: '2',
          username: 'bob',
          url: 'https://llun.test/users/bob'
        } as Mastodon.Account
      ]
    ])
    const database = {
      getMastodonActorsFromIds: vi.fn(({ ids }: { ids: string[] }) =>
        Promise.resolve(
          ids
            .map((id) => accountByActorId.get(id))
            .filter((account): account is Mastodon.Account => Boolean(account))
        )
      )
    } as unknown as Database
    const conversations = [
      {
        participantActorIds: [
          'https://llun.test/users/me',
          'https://llun.test/users/alice'
        ]
      },
      {
        participantActorIds: [
          'https://llun.test/users/me',
          'https://llun.test/users/alice',
          'https://llun.test/users/bob'
        ]
      }
    ] as DirectConversation[]

    const accountsByActorId = await getMastodonConversationAccountMap(
      database,
      conversations,
      'https://llun.test/users/me'
    )

    expect(database.getMastodonActorsFromIds).toHaveBeenCalledTimes(1)
    expect(database.getMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://llun.test/users/alice', 'https://llun.test/users/bob']
    })
    expect(accountsByActorId.get('https://llun.test/users/alice')).toEqual(
      accountByActorId.get('https://llun.test/users/alice')
    )
  })

  it('keys hydrated accounts by actor id when account url is a profile url', async () => {
    const actorId = 'https://remote.example/users/alice'
    const profileUrl = 'https://remote.example/@alice'
    const account = {
      ...mastodonAccount(actorId),
      id: urlToId(actorId),
      url: profileUrl
    }
    const database = {
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([account])
    } as unknown as Database
    const conversations = [
      {
        participantActorIds: ['https://llun.test/users/me', actorId]
      }
    ] as DirectConversation[]

    const accountsByActorId = await getMastodonConversationAccountMap(
      database,
      conversations,
      'https://llun.test/users/me'
    )

    expect(accountsByActorId.get(actorId)).toBe(account)
    expect(accountsByActorId.get(profileUrl)).toBeUndefined()
  })

  it('keeps participant account order from the conversation when using a hydrated map', () => {
    const alice = {
      id: '1',
      username: 'alice',
      url: 'https://llun.test/users/alice'
    } as Mastodon.Account
    const bob = {
      id: '2',
      username: 'bob',
      url: 'https://llun.test/users/bob'
    } as Mastodon.Account
    const conversation = {
      participantActorIds: [
        'https://llun.test/users/me',
        'https://llun.test/users/bob',
        'https://llun.test/users/missing',
        'https://llun.test/users/alice'
      ]
    } as DirectConversation

    expect(
      getMastodonConversationAccounts(
        conversation,
        'https://llun.test/users/me',
        new Map([
          ['https://llun.test/users/alice', alice],
          ['https://llun.test/users/bob', bob]
        ])
      )
    ).toEqual([bob, alice])
  })

  it('returns null when the conversation cannot be serialized as Mastodon JSON', async () => {
    const database = {
      getMastodonActorsFromIds: vi
        .fn()
        .mockResolvedValue([{ id: 123, url: 'bad-account' }])
    } as unknown as Database
    const conversation = {
      id: 'conversation-1',
      unread: false,
      participantActorIds: ['https://llun.test/users/me', 'bad-account'],
      lastStatus: {
        id: 'status-1'
      }
    } as DirectConversation

    await expect(
      getMastodonConversation(
        database,
        conversation,
        'https://llun.test/users/me'
      )
    ).resolves.toBeNull()
  })

  it('hydrates conversation last statuses in one batch', async () => {
    const firstStatus = status('https://llun.test/users/alice/statuses/1')
    const secondStatus = status('https://llun.test/users/alice/statuses/2')
    const conversations = [
      {
        id: 'conversation-1',
        unread: false,
        participantActorIds: ['https://llun.test/users/alice'],
        lastStatus: firstStatus
      },
      {
        id: 'conversation-2',
        unread: true,
        participantActorIds: ['https://llun.test/users/bob'],
        lastStatus: secondStatus
      }
    ] as DirectConversation[]
    const database = {} as Database
    const accountsByActorId = new Map([
      [
        'https://llun.test/users/alice',
        mastodonAccount('https://llun.test/users/alice')
      ],
      [
        'https://llun.test/users/bob',
        mastodonAccount('https://llun.test/users/bob')
      ]
    ])
    ;(getMastodonStatuses as jest.Mock).mockResolvedValue([
      mastodonStatus(firstStatus.id),
      mastodonStatus(secondStatus.id)
    ])

    const results = await getMastodonConversations(
      database,
      conversations,
      'https://llun.test/users/me',
      accountsByActorId
    )

    expect(getMastodonStatuses).toHaveBeenCalledTimes(1)
    expect(getMastodonStatuses).toHaveBeenCalledWith(
      database,
      [firstStatus, secondStatus],
      'https://llun.test/users/me'
    )
    expect(
      results.map((conversation) => conversation.last_status?.uri)
    ).toEqual([firstStatus.id, secondStatus.id])
  })

  it('matches hydrated conversation statuses by uri', async () => {
    const firstStatus = status('https://llun.test/users/alice/statuses/first')
    const secondStatus = status('https://llun.test/users/alice/statuses/second')
    const conversations = [
      {
        id: 'conversation-1',
        unread: false,
        participantActorIds: ['https://llun.test/users/alice'],
        lastStatus: firstStatus
      },
      {
        id: 'conversation-2',
        unread: false,
        participantActorIds: ['https://llun.test/users/bob'],
        lastStatus: secondStatus
      }
    ] as DirectConversation[]
    const accountsByActorId = new Map([
      [
        'https://llun.test/users/alice',
        mastodonAccount('https://llun.test/users/alice')
      ],
      [
        'https://llun.test/users/bob',
        mastodonAccount('https://llun.test/users/bob')
      ]
    ])
    ;(getMastodonStatuses as jest.Mock).mockResolvedValue([
      mastodonStatus(secondStatus.id)
    ])

    const results = await getMastodonConversations(
      {} as Database,
      conversations,
      'https://llun.test/users/me',
      accountsByActorId
    )

    expect(results[0].last_status).toBeNull()
    expect(results[1].last_status?.uri).toBe(secondStatus.id)
  })
})
