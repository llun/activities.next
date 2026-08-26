import { compactActivityPub } from '@/lib/activities/jsonld'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import type { Status } from '@/lib/types/domain/status'
import { toActivityPubObject } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const ACTOR_ID = 'https://llun.test/users/me'
const STATUS_ID = `${ACTOR_ID}/statuses/1`

const status = (): Status =>
  ({
    id: STATUS_ID,
    type: 'Note',
    actorId: ACTOR_ID,
    url: 'https://llun.test/@me/1',
    text: 'hello',
    summary: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply: '',
    attachments: [
      {
        id: 'att1',
        statusId: STATUS_ID,
        type: 'attachment',
        mediaType: 'image/png',
        url: 'https://llun.test/api/v1/files/medias/one.png',
        width: 100,
        height: 50,
        name: 'a photo',
        blurhash: 'LEHV6nWB2yk8pyo0adR*',
        focus: { x: -0.5, y: 0.25 },
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ],
    tags: [],
    replies: [],
    edits: [],
    totalLikes: 0,
    totalShares: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }) as unknown as Status

describe('EXPERIMENT outbox page item', () => {
  it('shows what getActorPosts sees', async () => {
    const page = {
      '@context': NOTE_ACTIVITY_CONTEXT,
      id: `${ACTOR_ID}/outbox?page=true`,
      type: 'OrderedCollectionPage',
      partOf: `${ACTOR_ID}/outbox`,
      orderedItems: [
        {
          id: `${STATUS_ID}/activity`,
          type: 'Create',
          actor: ACTOR_ID,
          published: '2023-11-14T22:13:20.000Z',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          object: toActivityPubObject(status())
        }
      ]
    }
    // What getActorPosts does: compact each ITEM, not the page.
    const item = await compactActivityPub(page.orderedItems[0])
    // What a conformant consumer that processes the whole document does.
    const whole = await compactActivityPub(page)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      '/tmp/exp2.json',
      JSON.stringify({ item, whole }, null, 2)
    )
  })
})
