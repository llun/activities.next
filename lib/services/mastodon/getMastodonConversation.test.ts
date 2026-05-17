import { Database } from '@/lib/database/types'
import {
  getMastodonConversation,
  getMastodonConversationAccountMap,
  getMastodonConversationAccounts
} from '@/lib/services/mastodon/getMastodonConversation'
import { Mastodon } from '@/lib/types/activitypub'
import { DirectConversation } from '@/lib/types/database/operations'

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: jest.fn().mockResolvedValue(null)
}))

describe('getMastodonConversation', () => {
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
      getMastodonActorsFromIds: jest.fn(({ ids }: { ids: string[] }) =>
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
      getMastodonActorsFromIds: jest
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
})
