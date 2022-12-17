import crypto from 'crypto'

import { GetLocalFollowersForActorIdParams } from '../storage/types'
import { MockActor } from '../stub/actor'
import { MockStatus } from '../stub/status'
import { getISOTimeUTC } from '../time'
import { Follow, FollowStatus } from './follow'
import { createStatus, toObject } from './status'

const mockStorage = {
  getLocalFollowersForActorId: jest.fn(
    async ({ targetActorId }: GetLocalFollowersForActorIdParams) => {
      if (targetActorId === 'https://chat.llun.dev/users/user3') {
        const follow: Follow = {
          id: crypto.randomUUID(),
          actorId: 'https://chat.llun.dev/users/user4',
          actorHost: 'llun.test',
          status: FollowStatus.Accepted,
          targetActorId: 'https://chat.llun.dev/users/user3',
          targetActorHost: 'mastodon.in.th',
          inbox: 'https://chat.llun.dev/users/user4/inbox',
          sharedInbox: 'https://chat.llun.dev/inbox',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        return [follow]
      }
      return []
    }
  )
} as any

describe('#createStatus', () => {
  const mockActor = MockActor({})
  const mockStatus = MockStatus({ text: 'This is sample reply message' })

  it('returns plain text status from content', async () => {
    const { status } = await createStatus({
      currentActor: mockActor,
      text: 'This is a first post',
      storage: mockStorage
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
      replyStatus: mockStatus,
      storage: mockStorage
    })
    expect(status.text).toEqual(
      '<p><span class="h-card"><a href="https://earth.social/@thai" class="u-url mention">@<span>thai</span></a></span> Hey! how are you?</p>'
    )
    expect(status.cc).toContain(`https://earth.social/users/thai`)
    expect(mentions).toHaveLength(1)
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: 'https://earth.social/users/thai',
      name: '@thai@earth.social'
    })
  })

  it('adds localRecipients in status', async () => {
    const mockActorWithLocaleFollowers = MockActor({
      id: 'https://chat.llun.dev/users/user3'
    })
    const { status } = await createStatus({
      currentActor: mockActorWithLocaleFollowers,
      text: '@thai@earth.social Hey! how are you?',
      replyStatus: mockStatus,
      storage: mockStorage
    })
    expect(status.localRecipients).toContain(
      'https://chat.llun.dev/users/user3'
    )
    expect(status.localRecipients).toContain(
      'https://chat.llun.dev/users/user4'
    )
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
        id: `${status.id}/replies`,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${status.id}/replies?only_other_accounts=true&page=true`,
          partOf: `${status.id}/replies`,
          items: []
        }
      }
    })
  })

  it('add mentions into Note object', async () => {
    const actor = MockActor({})
    const { status, mentions } = await createStatus({
      currentActor: actor,
      text: '@null@llun.dev Heyllo',
      storage: mockStorage
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
        id: `${status.id}/replies`,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${status.id}/replies?only_other_accounts=true&page=true`,
          partOf: `${status.id}/replies`,
          items: []
        }
      }
    })
  })

  it('update all reply related properties', async () => {
    const firstActor = MockActor({ id: 'https://chat.llun.dev/users/user1' })
    const secondActor = MockActor({ id: 'https://chat.llun.dev/users/user2' })
    const { status: originalStatus } = await createStatus({
      currentActor: firstActor,
      text: 'Yo',
      storage: mockStorage
    })
    const { status, mentions } = await createStatus({
      currentActor: secondActor,
      text: '@user1 Heyllo',
      replyStatus: originalStatus,
      storage: mockStorage
    })
    const note = toObject({ status, mentions, replyStatus: originalStatus })
    expect(note).toMatchObject({
      id: status.id,
      type: 'Note',
      summary: null,
      published: getISOTimeUTC(status.createdAt),
      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      inReplyTo: originalStatus.id,
      content: status.text,
      attachment: [],
      tag: mentions,
      replies: {
        id: `${status.id}/replies`,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${status.id}/replies?only_other_accounts=true&page=true`,
          partOf: `${status.id}/replies`,
          items: []
        }
      }
    })
  })
})
