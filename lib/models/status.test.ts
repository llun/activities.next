import { Actor } from './actor'
import { Status, createStatus } from './status'

const MockActor: Actor = {
  id: 'https://chat.llun.dev/users/me',
  preferredUsername: 'me',
  manuallyApprovesFollowers: false,
  discoverable: true,
  publicKey: '',
  privateKey: '',
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const MockStatus: Status = {
  id: 'https://chat.llun.dev/users/llun/statuses/12345',
  type: 'Note',
  actorId: 'https://earth.social/users/thai',
  text: 'This is sample reply message',
  url: 'https://chat.llun.dev/@llun/statuses/12345',
  cc: [],
  to: [],
  conversation: 'conversation-id',
  sensitive: false,
  visibility: 'public',
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 3600000
}

describe('#createStatus', () => {
  it('returns plain text status from content', async () => {
    const status = await createStatus({
      currentActor: MockActor,
      text: 'This is a first post'
    })

    expect(status.actorId).toEqual(MockActor.id)
    expect(status.type).toEqual('Note')
    expect(status.to).toContain('https://www.w3.org/ns/activitystreams#Public')
    expect(status.cc).toContain(`${MockActor.id}/followers`)
    expect(status.text).toEqual('<p>This is a first post</p>')
  })

  it.only('returns status with conversation from reply', async () => {
    const status = await createStatus({
      currentActor: MockActor,
      text: '@thai@earth.social Hey! how are you?',
      replyStatus: MockStatus
    })
    expect(status.text).toEqual(
      '<p><span class="h-card"><a href="https://earth.social/@thai" class="u-url mention">@<span>earth</span></a></span> Hey! how are you?</p>'
    )
    expect(status.conversation).toEqual(MockStatus.conversation)
    expect(status.cc).toContain(`https://earth.social/users/thai`)
  })
})
