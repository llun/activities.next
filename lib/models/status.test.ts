import { MockActor } from '../stub/actor'
import { MockStatus } from '../stub/status'
import { createStatus } from './status'

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
