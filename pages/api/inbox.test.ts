import { fromJson } from '../../lib/models/status'
import { MockImageDocument } from '../../lib/stub/imageDocument'
import { MockNote } from '../../lib/stub/note'
import { handleCreate } from './inbox'

const mockStorage = {
  createStatus: jest.fn(),
  createAttachment: jest.fn()
} as any

jest.useFakeTimers().setSystemTime(new Date('2022-11-28'))

describe('#handleCreate', () => {
  it('add status into storage', async () => {
    const note = MockNote({ content: '<p>Hello</p>' })
    await handleCreate({ storage: mockStorage, object: note })
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: fromJson(note)
    })
  })

  it('add status and attachments with status id into storage', async () => {
    const note = MockNote({
      content: '<p>Hello<p>',
      documents: [
        MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
        MockImageDocument({
          url: 'https://llun.dev/images/test2.jpg',
          name: 'Second image'
        })
      ]
    })
    await handleCreate({ storage: mockStorage, object: note })
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: fromJson(note)
    })
    expect(mockStorage.createAttachment).toHaveBeenCalledTimes(2)
    expect(mockStorage.createAttachment).toHaveBeenCalledWith({
      statusId: note.id,
      mediaType: 'image/jpeg',
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
