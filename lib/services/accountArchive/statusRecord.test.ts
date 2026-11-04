import { buildStatusRecord } from '@/lib/services/accountArchive/statusRecord'
import type { Attachment } from '@/lib/types/domain/attachment'
import { type Status, StatusType } from '@/lib/types/domain/status'

const actorId = 'https://archive.test/users/rider'
const statusId = `${actorId}/statuses/1`

const attachment = (
  id: string,
  name: string,
  extra: Partial<Attachment> = {}
): Attachment => ({
  id,
  actorId,
  statusId,
  type: 'Document',
  mediaType: 'image/webp',
  url: `https://archive.test/api/v1/files/medias/${id}.webp`,
  name,
  mediaId: id,
  createdAt: 0,
  updatedAt: 0,
  ...extra
})

describe('buildStatusRecord', () => {
  it('carries the route map flag, and only on the map', () => {
    const status = {
      id: statusId,
      actorId,
      type: StatusType.enum.Note,
      to: [],
      cc: [],
      url: statusId,
      text: 'Ride',
      tags: [],
      attachments: [
        attachment('1', 'Loop around the lake', { isRouteMap: true }),
        attachment('2', 'Summit')
      ],
      createdAt: 0,
      updatedAt: 0
    } as unknown as Status

    const record = buildStatusRecord({
      status,
      pinned: false,
      history: null,
      urlToArchivePath: (url) => url
    }) as { attachments: Record<string, unknown>[] }

    expect(record.attachments[0]).toMatchObject({
      name: 'Loop around the lake',
      isRouteMap: true
    })
    expect(record.attachments[1]).not.toHaveProperty('isRouteMap')
  })
})
