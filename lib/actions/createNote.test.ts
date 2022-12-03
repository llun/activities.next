import { fromJson } from '../models/status'
import { MockActor } from '../stub/actor'
import { MockImageDocument } from '../stub/imageDocument'
import { MockMastodonNote } from '../stub/note'
import { createNote, createNoteFromUserInput } from './createNote'

const mockStorage = {
  createStatus: jest.fn(),
  createAttachment: jest.fn(),
  getStatus: jest.fn()
} as any

jest.useFakeTimers().setSystemTime(new Date('2022-11-28'))

describe('#createNote', () => {
  it('adds not into storage and returns note', async () => {
    const note = MockMastodonNote({ content: '<p>Hello</p>' })
    expect(await createNote({ storage: mockStorage, note })).toEqual(note)
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: fromJson(note)
    })
  })

  it('add status and attachments with status id into storage', async () => {
    const note = MockMastodonNote({
      content: '<p>Hello<p>',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ]
    })
    expect(await createNote({ storage: mockStorage, note })).toEqual(note)
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: fromJson(note)
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
})

describe('#createNoteFromUserInput', () => {
  const mockActor = MockActor({ id: 'https://llun.test/users/null' })
  it('adds status to database and returns note', async () => {
    const note = await createNoteFromUserInput({
      text: 'Hello',
      currentActor: mockActor,
      storage: mockStorage
    })
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: {
        id: note.id,
        actorId: mockActor.id,
        type: 'Note',
        text: `<p>Hello</p>`,
        reply: expect.toBeString(),
        summary: null,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${mockActor.id}/followers`],
        createdAt: expect.toBeNumber(),
        url: expect.toBeString()
      }
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
