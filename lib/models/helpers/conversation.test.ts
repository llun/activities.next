import { MockStatus } from '../../stub/status'
import { Status } from '../status'
import { conversation } from './conversation'

describe('#conversation', () => {
  const mocks: Status[] = [
    MockStatus({ text: 'last message', createdAt: 1000 }),
    MockStatus({
      text: 'conversation end',
      conversation: 'conversation1',
      createdAt: 800
    }),
    MockStatus({ text: 'other message', createdAt: 790 }),
    MockStatus({ text: 'other message2', createdAt: 785 }),
    MockStatus({
      text: 'other conversation',
      conversation: 'conversation1',
      createdAt: 750
    }),
    MockStatus({
      text: 'other conversation2',
      conversation: 'conversation2',
      createdAt: 740
    }),
    MockStatus({
      text: 'random message',
      createdAt: 735
    }),
    MockStatus({
      text: 'start conversation1',
      conversation: 'conversation1',
      createdAt: 730
    }),
    MockStatus({
      text: 'start conversation2',
      conversation: 'conversation2',
      createdAt: 725
    })
  ]

  it('groups messages with conversation thread', () => {
    const conversations = [
      {
        conversation: 'conversation-1000',
        timestamp: 1000,
        statuses: [mocks[0]]
      },
      {
        conversation: 'conversation1',
        timestamp: 800,
        statuses: [mocks[1], mocks[4], mocks[7]]
      },
      {
        conversation: 'conversation-790',
        timestamp: 790,
        statuses: [mocks[2]]
      },
      {
        conversation: 'conversation-785',
        timestamp: 785,
        statuses: [mocks[3]]
      },
      {
        conversation: 'conversation2',
        timestamp: 740,
        statuses: [mocks[5], mocks[8]]
      },
      {
        conversation: 'conversation-735',
        timestamp: 735,
        statuses: [mocks[6]]
      }
    ]
    expect(conversation(mocks)).toEqual(conversations)
  })
})
