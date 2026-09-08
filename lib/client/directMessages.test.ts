import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { createDirectMessage } from './directMessages'

enableFetchMocks()

describe('client directMessages module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('createDirectMessage', () => {
    it('throws when message is empty or whitespace only', async () => {
      await expect(
        createDirectMessage({
          message: '   ',
          recipients: [
            {
              id: 'acc-1',
              username: 'ada',
              acct: 'ada'
            } as MastodonAccount
          ]
        })
      ).rejects.toThrow('Message must not be empty')
    })

    it('throws when recipients list is empty and no replyStatus is provided', async () => {
      await expect(
        createDirectMessage({
          message: 'hello',
          recipients: []
        })
      ).rejects.toThrow('At least one recipient is required')
    })

    it('sends direct message without replyStatus', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'status-1',
          uri: 'https://local.example/statuses/1'
        }),
        {
          status: 200
        }
      )

      const recipient = {
        id: 'acc-1',
        username: 'ada',
        acct: 'ada@example.com'
      } as MastodonAccount

      const result = await createDirectMessage({
        message: 'Hello Ada',
        recipients: [recipient]
      })

      expect(result).toEqual({
        id: 'status-1',
        uri: 'https://local.example/statuses/1'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            status: '@ada@example.com Hello Ada',
            visibility: 'direct'
          })
        })
      )
    })

    it('mentions extra reply recipients without duplicating existing participants', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'status-1',
          uri: 'https://local.example/statuses/1'
        }),
        {
          status: 200
        }
      )

      const replyStatus = {
        id: 'https://local.example/users/me/statuses/root',
        actorId: 'https://local.example/users/me',
        to: ['https://local.example/users/ada'],
        cc: ['https://local.example/users/me']
      } as Status
      const existingRecipientActorId = 'https://local.example/users/ada'
      const existingRecipient = {
        id: urlToId(existingRecipientActorId),
        url: 'https://local.example/@ada',
        username: 'ada',
        acct: 'ada@local.example'
      } as MastodonAccount
      const extraRecipient = {
        id: 'https://remote.example/users/bea',
        url: 'https://remote.example/users/bea',
        username: 'bea',
        acct: 'bea@remote.example'
      } as MastodonAccount

      await createDirectMessage({
        message: 'hello',
        recipients: [existingRecipient, extraRecipient],
        replyStatus
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          body: JSON.stringify({
            status: '@bea@remote.example hello',
            visibility: 'direct',
            in_reply_to_id: replyStatus.id
          })
        })
      )
    })

    it('recognizes an existing participant whose account id is a public id', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'status-1',
          uri: 'https://local.example/statuses/1'
        }),
        {
          status: 200
        }
      )

      const replyStatus = {
        id: 'https://local.example/users/me/statuses/root',
        actorId: 'https://local.example/users/me',
        to: ['https://local.example/users/ada'],
        cc: ['https://local.example/users/me']
      } as Status
      const existingRecipient = {
        id: generatePublicId(),
        uri: 'https://local.example/users/ada',
        url: 'https://local.example/@ada',
        username: 'ada',
        acct: 'ada@local.example'
      } as MastodonAccount

      await createDirectMessage({
        message: 'hello',
        recipients: [existingRecipient],
        replyStatus
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/statuses',
        expect.objectContaining({
          body: JSON.stringify({
            status: 'hello',
            visibility: 'direct',
            in_reply_to_id: replyStatus.id
          })
        })
      )
    })

    it('throws when the status creation fails', async () => {
      fetchMock.mockResponseOnce('Forbidden', { status: 403 })

      await expect(
        createDirectMessage({
          message: 'hello',
          recipients: [{ id: 'acc-1', username: 'ada' } as MastodonAccount]
        })
      ).rejects.toThrow('Failed to send message')
    })
  })
})
