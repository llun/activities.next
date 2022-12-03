import { fromJson } from '../models/status'
import { MockImageDocument } from '../stub/imageDocument'
import { MockMastodonNote } from '../stub/note'
import { createNote } from './createNote'

const mockStorage = {
  createStatus: jest.fn(),
  createAttachment: jest.fn()
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
