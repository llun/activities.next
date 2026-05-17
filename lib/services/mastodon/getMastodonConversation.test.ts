import { Database } from '@/lib/database/types'
import { getMastodonConversation } from '@/lib/services/mastodon/getMastodonConversation'
import { DirectConversation } from '@/lib/types/database/operations'

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: jest.fn().mockResolvedValue(null)
}))

describe('getMastodonConversation', () => {
  it('returns null when the conversation cannot be serialized as Mastodon JSON', async () => {
    const database = {
      getMastodonActorFromId: jest.fn().mockResolvedValue({
        id: 123
      })
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
