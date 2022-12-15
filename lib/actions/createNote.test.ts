import crypto from 'crypto'

import { Follow, FollowStatus } from '../models/follow'
import { fromJson } from '../models/status'
import {
  GetActorFromIdParams,
  GetLocalFollowersForActorIdParams
} from '../storage/types'
import { MockActor } from '../stub/actor'
import { MockImageDocument } from '../stub/imageDocument'
import { MockMastodonNote } from '../stub/note'
import { createNote, createNoteFromUserInput } from './createNote'

jest.mock('../config', () => ({
  __esModule: true,
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test'
  })
}))

const mockStorage = {
  createStatus: jest.fn(),
  createAttachment: jest.fn(),
  getStatus: jest.fn(),
  getActorFromId: jest.fn(async ({ id }: GetActorFromIdParams) => {
    if (['https://llun.test/users/null'].includes(id)) return MockActor({ id })
  }),
  getLocalFollowersForActorId: jest.fn(
    async ({ targetActorId }: GetLocalFollowersForActorIdParams) => {
      if (targetActorId === 'https://mastodon.in.th/users/friend') {
        const follow: Follow = {
          id: crypto.randomUUID(),
          actorId: 'https://llun.test/users/null',
          actorHost: 'llun.test',
          status: FollowStatus.Accepted,
          targetActorId: 'https://mastodon.in.th/users/friend',
          targetActorHost: 'mastodon.in.th',
          inbox: 'https://llun.test/users/null/inbox',
          sharedInbox: 'https://llun.test/inbox',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        return [follow]
      }
      return []
    }
  )
} as any

jest.useFakeTimers().setSystemTime(new Date('2022-11-28'))

describe('#createNote', () => {
  it('adds not into storage and returns note', async () => {
    const note = MockMastodonNote({ content: '<p>Hello</p>' })
    expect(await createNote({ storage: mockStorage, note })).toEqual(note)
    const expectStatus = {
      ...fromJson(note),
      localRecipients: ['as:Public']
    }
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: expectStatus
    })
  })

  it('add status and attachments with status id into storage', async () => {
    const note = MockMastodonNote({
      content: '<p>Hello</p>',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ]
    })
    expect(await createNote({ storage: mockStorage, note })).toEqual(note)

    const expectStatus = {
      ...fromJson(note),
      localRecipients: ['as:Public']
    }
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: expectStatus
    })
    expect(mockStorage.createAttachment).toHaveBeenCalledTimes(2)
    expect(mockStorage.createAttachment).toHaveBeenCalledWith({
      statusId: note.id,
      mediaType: 'image/jpeg',
      name: '',
      url: 'https://llun.dev/images/test1.jpg',
      width: 2000,
      height: 1500
    })
    expect(mockStorage.createAttachment).toHaveBeenCalledWith({
      statusId: note.id,
      mediaType: 'image/jpeg',
      url: 'https://llun.dev/images/test2.jpg',
      width: 2000,
      height: 1500,
      name: 'Second image'
    })
  })

  it('add add local followers in recipients', async () => {
    const note = MockMastodonNote({
      content: '<p>Hello</p>',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ],
      cc: ['https://mastodon.in.th/users/friend/followers']
    })
    expect(await createNote({ storage: mockStorage, note })).toEqual(note)

    const expectStatus = {
      id: note.id,
      actorId: note.attributedTo,
      type: 'Note',
      text: `<p>Hello</p>`,
      reply: expect.toBeString(),
      summary: '',
      to: note.to,
      cc: note.cc,
      localRecipients: ['as:Public', 'https://llun.test/users/null'],
      createdAt: expect.toBeNumber(),
      updatedAt: expect.toBeNumber(),
      url: expect.toBeString()
    }
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: expectStatus
    })
  })
})

describe('#createNoteFromUserInput', () => {
  it('adds status to database and returns note', async () => {
    const mockActor = MockActor({ id: 'https://llun.test/users/null' })
    const { status, note } = await createNoteFromUserInput({
      text: 'Hello',
      currentActor: mockActor,
      storage: mockStorage
    })
    const expectStatus = {
      id: note.id,
      actorId: mockActor.id,
      type: 'Note',
      text: `<p>Hello</p>`,
      reply: expect.toBeString(),
      summary: null,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${mockActor.id}/followers`],
      localRecipients: ['as:Public', 'https://llun.test/users/null'],
      createdAt: expect.toBeNumber(),
      updatedAt: expect.toBeNumber(),
      url: expect.toBeString()
    }
    expect(status).toEqual(expectStatus)
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: expectStatus
    })
    expect(note).toMatchObject({
      type: 'Note',
      content: '<p>Hello</p>',
      attributedTo: mockActor.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${mockActor.id}/followers`]
    })
  })

  it('adds local followers as recipients', async () => {
    const mockActor = MockActor({ id: 'https://mastodon.in.th/users/friend' })
    const { status, note } = await createNoteFromUserInput({
      text: 'Hello',
      currentActor: mockActor,
      storage: mockStorage
    })
    const expectStatus = {
      id: note.id,
      actorId: mockActor.id,
      type: 'Note',
      text: `<p>Hello</p>`,
      reply: expect.toBeString(),
      summary: null,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${mockActor.id}/followers`],
      localRecipients: [
        'as:Public',
        'https://mastodon.in.th/users/friend',
        'https://llun.test/users/null'
      ],
      createdAt: expect.toBeNumber(),
      updatedAt: expect.toBeNumber(),
      url: expect.toBeString()
    }
    expect(status).toEqual(expectStatus)
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: expectStatus
    })
    expect(note).toMatchObject({
      type: 'Note',
      content: '<p>Hello</p>',
      attributedTo: mockActor.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${mockActor.id}/followers`]
    })
  })
})
