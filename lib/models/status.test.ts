import { MockActor } from '../stub/actor'
import { MockStatus } from '../stub/status'
import { Status, createStatus, group } from './status'

describe('#createStatus', () => {
  const mockActor = MockActor()
  const mockStatus = MockStatus({ text: 'This is sample reply message' })

  it('returns plain text status from content', async () => {
    const { status } = await createStatus({
      currentActor: mockActor,
      text: 'This is a first post'
    })

    expect(status.actorId).toEqual(mockActor.id)
    expect(status.type).toEqual('Note')
    expect(status.to).toContain('https://www.w3.org/ns/activitystreams#Public')
    expect(status.cc).toContain(`${mockActor.id}/followers`)
    expect(status.text).toEqual('<p>This is a first post</p>')
  })

  it('returns status with conversation and mentions from reply', async () => {
    const { status, mentions } = await createStatus({
      currentActor: mockActor,
      text: '@thai@earth.social Hey! how are you?',
      replyStatus: mockStatus
    })
    expect(status.text).toEqual(
      '<p><span class="h-card"><a href="https://earth.social/@thai" class="u-url mention">@<span>thai</span></a></span> Hey! how are you?</p>'
    )
    expect(status.conversation).toEqual(mockStatus.conversation)
    expect(status.cc).toContain(`https://earth.social/users/thai`)
    expect(mentions).toHaveLength(1)
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: 'https://earth.social/users/thai',
      name: '@thai@earth.social'
    })
  })
})

describe('#group', () => {
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
    expect(group(mocks)).toEqual(conversations)
  })
})
