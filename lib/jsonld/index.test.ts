import { MockMastodonCreateActivity } from '../stub/createActivity'
import { compact } from './index'

jest.useFakeTimers().setSystemTime(new Date('2022-11-28'))

describe('#compact', () => {
  it('return clean input from jsonld compact', async () => {
    const activity = MockMastodonCreateActivity({
      content: 'Simple Content',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://llun.test/users/llun/followers']
    })
    const compactedActivity = await compact(activity)
    expect(compactedActivity).toMatchObject({
      id: 'https://llun.test/users/llun/statuses/109417500731428509/activity',
      type: 'Create',
      actor: 'https://llun.test/users/llun',
      cc: 'https://llun.test/users/llun/followers',
      object: {
        id: 'https://llun.test/users/llun/statuses/109417500731428509',
        type: 'Note',
        attributedTo: 'https://llun.test/users/llun',
        cc: 'https://llun.test/users/llun/followers',
        content: 'Simple Content',
        contentMap: { en: 'Simple Content' },
        published: '2022-11-28T00:00:00Z',
        replies: {
          id: 'https://llun.test/users/llun/statuses/109417500731428509/replies',
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [],
            next: 'https://llun.test/users/llun/statuses/109417500731428509/replies?only_other_accounts=true&page=true',
            partOf:
              'https://llun.test/users/llun/statuses/109417500731428509/replies'
          }
        },
        tag: [],
        to: 'as:Public',
        url: 'https://llun.test/@llun/109417500731428509'
      },
      published: '2022-11-28T00:00:00Z',
      to: 'as:Public'
    })
  })

  it('return to and cc as array', async () => {
    const activity = MockMastodonCreateActivity({
      content: 'Simple Content',
      to: [
        'https://www.w3.org/ns/activitystreams#Public',
        'https://llun.dev/users/null'
      ],
      cc: [
        'https://llun.test/users/llun/followers',
        'https://llun.dev/users/null/followers'
      ]
    })
    const compactedActivity = await compact(activity)
    expect(compactedActivity).toMatchObject({
      id: 'https://llun.test/users/llun/statuses/109417500731428509/activity',
      type: 'Create',
      actor: 'https://llun.test/users/llun',
      cc: [
        'https://llun.test/users/llun/followers',
        'https://llun.dev/users/null/followers'
      ],
      object: {
        id: 'https://llun.test/users/llun/statuses/109417500731428509',
        type: 'Note',
        attributedTo: 'https://llun.test/users/llun',
        cc: [
          'https://llun.test/users/llun/followers',
          'https://llun.dev/users/null/followers'
        ],
        content: 'Simple Content',
        contentMap: { en: 'Simple Content' },
        published: '2022-11-28T00:00:00Z',
        replies: {
          id: 'https://llun.test/users/llun/statuses/109417500731428509/replies',
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [],
            next: 'https://llun.test/users/llun/statuses/109417500731428509/replies?only_other_accounts=true&page=true',
            partOf:
              'https://llun.test/users/llun/statuses/109417500731428509/replies'
          }
        },
        tag: [],
        to: ['as:Public', 'https://llun.dev/users/null'],
        url: 'https://llun.test/@llun/109417500731428509'
      },
      published: '2022-11-28T00:00:00Z',
      to: ['as:Public', 'https://llun.dev/users/null']
    })
  })
})
