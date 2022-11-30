import { MockActor } from '../stub/actor'
import { MockStatus } from '../stub/status'
import { getISOTimeUTC } from '../time'
import { createStatus, toObject } from './status'

describe('#createStatus', () => {
  const mockActor = MockActor({})
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
})

describe('#toObject', () => {
  it('converts status to Note object', () => {
    const status = MockStatus({ text: 'Hello' })
    const note = toObject({ status })
    expect(note).toEqual({
      id: status.id,
      type: 'Note',
      summary: null,
      inReplyTo: null,
      published: getISOTimeUTC(status.createdAt),
      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      content: status.text,
      attachment: [],
      tag: [],
      replies: {
        id: status.reply,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${status.reply}?only_other_accounts=true&page=true`,
          partOf: status.reply,
          items: []
        }
      }
    })
  })

  it('add mentions into Note object', async () => {
    const actor = MockActor({})
    const { status, mentions } = await createStatus({
      currentActor: actor,
      text: '@null@llun.dev Heyllo'
    })
    const note = toObject({ status, mentions })
    expect(note).toMatchObject({
      id: status.id,
      type: 'Note',
      summary: null,
      inReplyTo: null,
      published: getISOTimeUTC(status.createdAt),
      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      content: status.text,
      attachment: [],
      tag: mentions,
      replies: {
        id: status.reply,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${status.reply}?only_other_accounts=true&page=true`,
          partOf: status.reply,
          items: []
        }
      }
    })
  })
})
