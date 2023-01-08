import { MockMastodonCreateActivity } from '../stub/createActivity'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { compact } from './index'

jest.useFakeTimers().setSystemTime(new Date('2022-11-28'))

describe('#compact', () => {
  it('return clean input from jsonld compact', async () => {
    const activity = MockMastodonCreateActivity({
      content: 'Simple Content',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${ACTOR1_ID}/followers`]
    })
    const compactedActivity = await compact(activity)
    expect(compactedActivity).toMatchObject({
      id: `${ACTOR1_ID}/statuses/109417500731428509/activity`,
      type: 'Create',
      actor: ACTOR1_ID,
      cc: `${ACTOR1_ID}/followers`,
      object: {
        id: activity.object.id,
        type: 'Note',
        attributedTo: ACTOR1_ID,
        cc: `${ACTOR1_ID}/followers`,
        content: 'Simple Content',
        contentMap: { en: 'Simple Content' },
        published: '2022-11-28T00:00:00Z',
        replies: {
          id: `${activity.object.id}/replies`,
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [],
            next: `${activity.object.id}/replies?only_other_accounts=true&page=true`,
            partOf: `${activity.object.id}/replies`
          }
        },
        tag: [],
        to: 'as:Public',
        url: activity.object.url
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
      cc: [`${ACTOR1_ID}/followers`, 'https://llun.dev/users/null/followers']
    })
    const compactedActivity = await compact(activity)
    expect(compactedActivity).toMatchObject({
      id: `${ACTOR1_ID}/statuses/109417500731428509/activity`,
      type: 'Create',
      actor: ACTOR1_ID,
      cc: [`${ACTOR1_ID}/followers`, 'https://llun.dev/users/null/followers'],
      object: {
        id: activity.object.id,
        type: 'Note',
        attributedTo: ACTOR1_ID,
        cc: [`${ACTOR1_ID}/followers`, 'https://llun.dev/users/null/followers'],
        content: 'Simple Content',
        contentMap: { en: 'Simple Content' },
        published: '2022-11-28T00:00:00Z',
        replies: {
          id: `${activity.object.id}/replies`,
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            items: [],
            next: `${activity.object.id}/replies?only_other_accounts=true&page=true`,
            partOf: `${activity.object.id}/replies`
          }
        },
        tag: [],
        to: ['as:Public', 'https://llun.dev/users/null'],
        url: activity.object.url
      },
      published: '2022-11-28T00:00:00Z',
      to: ['as:Public', 'https://llun.dev/users/null']
    })
  })
})
