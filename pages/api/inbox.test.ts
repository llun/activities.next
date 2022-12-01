import { fromJson } from '../../lib/models/status'
import { MockCreateActivity } from '../../lib/stub/createActivity'
import { MockImageDocument } from '../../lib/stub/imageDocument'
import { MockNote } from '../../lib/stub/note'
import { compact, handleCreate } from './inbox'

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

describe('#compact', () => {
  it('return clean input from jsonld compact', async () => {
    const activity = MockCreateActivity({
      content: 'Simple Content'
    })
    const compactedActivity = await compact(activity)
    expect(compactedActivity).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://glasgow.social/users/llun/statuses/109417500731428509/activity',
      type: 'Create',
      actor: 'https://glasgow.social/users/llun',
      cc: 'https://glasgow.social/users/llun/followers',
      object: {
        id: 'https://glasgow.social/users/llun/statuses/109417500731428509',
        type: 'Note',
        attributedTo: 'https://glasgow.social/users/llun',
        cc: 'https://glasgow.social/users/llun/followers',
        content: 'Simple Content',
        contentMap: { en: 'Simple Content' },
        published: '2022-11-28T00:00:00Z',
        replies: {
          id: 'https://glasgow.social/users/llun/statuses/109417500731428509/replies',
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [],
            next: 'https://glasgow.social/users/llun/statuses/109417500731428509/replies?only_other_accounts=true&page=true',
            partOf:
              'https://glasgow.social/users/llun/statuses/109417500731428509/replies'
          }
        },
        tag: [],
        to: 'as:Public',
        url: 'https://glasgow.social/@llun/109417500731428509'
      },
      published: '2022-11-28T00:00:00Z',
      to: 'as:Public'
    })
  })
})
