import { Database } from '@/lib/database/types'
import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { clearAnimationMetadataCacheForTests } from '@/lib/services/medias/animationMetadata'
import { Timeline } from '@/lib/services/timelines/types'
import {
  GetBlockRelationsParams,
  GetMuteRelationsParams
} from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  getFilteredStatusPage,
  getFilteredTimelinePage
} from './getFilteredTimelinePage'

vi.mock('@/lib/services/federation/serverSoftware', () => ({
  getServerSoftware: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const readerActorId = 'https://llun.test/users/reader'
const blockedActorId = 'https://blocked.test/users/blocked'
const mutedActorId = 'https://muted.test/users/muted'
const blockedDomainActorId = 'https://blocked-domain.test/users/author'

const createStatus = (name: string, actorId = readerActorId) =>
  ({
    id: `https://llun.test/users/reader/statuses/${name}`,
    actorId,
    type: StatusType.enum.Note
  }) as Status

describe('getFilteredStatusPage', () => {
  it('emits the last visible cursor mid-timeline when the page is full and more remain', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const visible4 = createStatus('visible-4')
    const visible5 = createStatus('visible-5')
    const visible6 = createStatus('visible-6')
    const batches = new Map<string | null, Status[]>([
      [null, [visible1, visible2, visible3]],
      [visible3.id, [visible4, visible5, visible6]]
    ])
    const getBlockRelations = vi.fn(async () => [])
    const getMuteRelations = vi.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database
    const fetchBatch = vi.fn(({ maxStatusId }) =>
      Promise.resolve(batches.get(maxStatusId) ?? [])
    )

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(visible3.id)
    expect(fetchBatch).toHaveBeenCalledTimes(1)
  })

  it('keeps a next cursor when a final exhausted batch buffers visible statuses', async () => {
    const blocked = createStatus('blocked', blockedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const visible4 = createStatus('visible-4')
    const batches = new Map<string | null, Status[]>([
      [null, [blocked, visible1, visible2]],
      [visible2.id, [visible3, visible4]]
    ])
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = vi.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(visible3.id)
  })

  it('uses the last scanned cursor when a full page ends with blocked statuses', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const blocked1 = createStatus('blocked-1', blockedActorId)
    const blocked2 = createStatus('blocked-2', blockedActorId)
    const blocked3 = createStatus('blocked-3', blockedActorId)
    const batches = new Map<string | null, Status[]>([
      [null, [blocked1, visible1, visible2]],
      [visible2.id, [visible3, blocked2, blocked3]]
    ])
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = vi.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(blocked3.id)
  })

  it('omits the next cursor when an exhausted batch exactly fills the visible page', async () => {
    const blocked = createStatus('blocked', blockedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const batches = new Map<string | null, Status[]>([
      [null, [blocked, visible1, visible2]],
      [visible2.id, [visible3]]
    ])
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = vi.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBeNull()
  })

  it('uses the last scanned cursor when capped scans find fewer visible statuses than the limit', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const batches = new Map<string | null, Status[]>([
      [
        null,
        [
          createStatus('blocked-1', blockedActorId),
          createStatus('blocked-2', blockedActorId),
          visible1
        ]
      ],
      [
        visible1.id,
        [
          createStatus('blocked-3', blockedActorId),
          createStatus('blocked-4', blockedActorId),
          createStatus('blocked-5', blockedActorId)
        ]
      ],
      [
        'https://llun.test/users/reader/statuses/blocked-5',
        [
          createStatus('blocked-6', blockedActorId),
          createStatus('blocked-7', blockedActorId),
          visible2
        ]
      ],
      [
        visible2.id,
        [
          createStatus('blocked-8', blockedActorId),
          createStatus('blocked-9', blockedActorId),
          createStatus('blocked-10', blockedActorId)
        ]
      ],
      [
        'https://llun.test/users/reader/statuses/blocked-10',
        [
          createStatus('blocked-11', blockedActorId),
          createStatus('blocked-12', blockedActorId),
          createStatus('blocked-13', blockedActorId)
        ]
      ]
    ])
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = vi.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id
    ])
    expect(page.nextMaxStatusId).toBe(
      'https://llun.test/users/reader/statuses/blocked-13'
    )
  })

  it('ascends from the cursor and returns the adjacent page newest-first for min_id', async () => {
    const a1 = createStatus('asc-1')
    const a2 = createStatus('asc-2')
    const a3 = createStatus('asc-3')
    const a4 = createStatus('asc-4')
    const a5 = createStatus('asc-5')
    // Ascending batches are oldest-first: the wrapper reverses getTimeline's
    // newest-first output for the backfill loop, and getTimeline(min_id='floor')
    // returns the oldest window just above the cursor.
    const batches = new Map<string | null, Status[]>([
      ['floor', [a1, a2, a3]],
      [a3.id, [a4, a5]]
    ])
    const database = {
      getBlockRelations: vi.fn(async () => []),
      getMuteRelations: vi.fn(async () => []),
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database
    const fetchBatch = vi.fn(({ minStatusId }) =>
      Promise.resolve(batches.get(minStatusId) ?? [])
    )

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      minStatusId: 'floor',
      fetchBatch
    })

    // The three oldest statuses above the cursor, returned newest-first.
    expect(page.statuses.map((status) => status.id)).toEqual([
      a3.id,
      a2.id,
      a1.id
    ])
    // prev (newer) continues above the newest returned; next (older) below the
    // oldest returned.
    expect(page.prevMinStatusId).toBe(a3.id)
    expect(page.nextMaxStatusId).toBe(a1.id)
    // Only the first ascending window was needed for a full page.
    expect(fetchBatch).toHaveBeenCalledTimes(1)
    expect(fetchBatch).toHaveBeenCalledWith(
      expect.objectContaining({ minStatusId: 'floor', maxStatusId: null })
    )
  })

  it('walks up past filtered rows to fill a min_id page', async () => {
    const a1 = createStatus('asc-a1')
    const a2 = createStatus('asc-a2')
    const a3 = createStatus('asc-a3')
    const blocked = createStatus('asc-blocked', blockedActorId)
    // floor → [blocked, a1, a2] then a2 → [a3]. The first window under-fills
    // after the block is dropped, so the loop ascends to a2 (the newest raw row
    // of the first window) for more.
    const batches = new Map<string | null, Status[]>([
      ['floor', [blocked, a1, a2]],
      [a2.id, [a3]]
    ])
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const database = {
      getBlockRelations,
      getMuteRelations: vi.fn(async () => []),
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database
    const fetchBatch = vi.fn(({ minStatusId }) =>
      Promise.resolve(batches.get(minStatusId) ?? [])
    )

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      minStatusId: 'floor',
      fetchBatch
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      a3.id,
      a2.id,
      a1.id
    ])
    expect(fetchBatch.mock.calls.map((call) => call[0].minStatusId)).toEqual([
      'floor',
      a2.id
    ])
  })

  it('keeps a min_id continuation cursor when a filtered window empties the capped ascending page', async () => {
    // Every row above the cursor is blocked and each ascending window is full,
    // so exhausted never trips and the backfill cap (5) is hit with nothing
    // visible. The page must still hand back a min_id continuation cursor (the
    // newest scanned id) so the client can page UP past the block, mirroring the
    // DESC branch's lastScannedStatusId fallback.
    const blockedBatches = new Map<string | null, Status[]>()
    let lastScanned = ''
    let key: string | null = 'floor'
    for (let window = 0; window < 5; window++) {
      const lo = createStatus(`cap-${window}-a`, blockedActorId)
      const hi = createStatus(`cap-${window}-b`, blockedActorId)
      blockedBatches.set(key, [lo, hi]) // oldest-first window of 2 blocked rows
      key = hi.id // ascending loop advances to the newest raw row
      lastScanned = hi.id
    }
    const getBlockRelations = vi.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const database = {
      getBlockRelations,
      getMuteRelations: vi.fn(async () => []),
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database
    const fetchBatch = vi.fn(({ minStatusId }) =>
      Promise.resolve(blockedBatches.get(minStatusId) ?? [])
    )

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 2,
      minStatusId: 'floor',
      fetchBatch
    })

    expect(page.statuses).toEqual([])
    // Continuation: prev (min_id, newer) advances past the block; there is no
    // older page to fetch, so next (max_id) stays null.
    expect(page.prevMinStatusId).toBe(lastScanned)
    expect(page.nextMaxStatusId).toBeNull()
    expect(fetchBatch).toHaveBeenCalledTimes(5)
  })

  it('omits statuses whose author the reader has muted', async () => {
    const muted = createStatus('muted', mutedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const batches = new Map<string | null, Status[]>([
      [null, [muted, visible1, visible2]],
      [visible2.id, [visible3]]
    ])
    const getBlockRelations = vi.fn(async () => [])
    const getMuteRelations = vi.fn(
      async ({ targetActorIds }: GetMuteRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === mutedActorId)
          ? [
              {
                actorId: readerActorId,
                targetActorId: mutedActorId,
                notifications: true
              }
            ]
          : []
    )
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBeNull()
  })

  it('fetches the viewer domain blocks once per page and drops statuses from blocked domains', async () => {
    const domainBlocked = createStatus('domain-blocked', blockedDomainActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const batches = new Map<string | null, Status[]>([
      [null, [domainBlocked, visible1, visible2]],
      [visible2.id, [visible3]]
    ])
    const getBlockRelations = vi.fn(async () => [])
    const getMuteRelations = vi.fn(async () => [])
    const getActorDomainBlocks = vi.fn(async () => [
      {
        id: 'domain-block-1',
        actorId: readerActorId,
        domain: 'blocked-domain.test',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    const database = {
      getBlockRelations,
      getMuteRelations,
      getActorDomainBlocks,
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    // Two batches were scanned, but the viewer's domain blocks are loaded
    // once per page request, not per batch.
    expect(getActorDomainBlocks).toHaveBeenCalledTimes(1)
    expect(getActorDomainBlocks).toHaveBeenCalledWith({
      actorId: readerActorId
    })
  })
})

describe('getFilteredTimelinePage', () => {
  it('bridges getTimeline newest-first output through the ascending loop back to newest-first for min_id', async () => {
    const s1 = createStatus('bridge-1')
    const s2 = createStatus('bridge-2')
    const s3 = createStatus('bridge-3')
    // getTimeline returns min_id windows newest-first (DB reverses internally).
    const getTimeline = vi.fn(
      async ({
        minStatusId
      }: {
        minStatusId?: string | null
        sinceStatusId?: string | null
      }) => (minStatusId === 'floor' ? [s3, s2, s1] : [])
    )
    const database = {
      getTimeline,
      getBlockRelations: vi.fn(async () => []),
      getMuteRelations: vi.fn(async () => []),
      getActorDomainBlocks: vi.fn(async () => []),
      getModerationStatesForActors: vi.fn(async () => new Map())
    } as unknown as Database

    const page = await getFilteredTimelinePage({
      database,
      timeline: Timeline.MAIN,
      actorId: readerActorId,
      minStatusId: 'floor',
      limit: 3
    })

    // The wrapper reverses getTimeline's newest-first batch to oldest-first for
    // the ascending loop, which reverses the assembled page back to newest-first:
    // the two flips compose without scrambling the order.
    expect(page.statuses.map((status) => status.id)).toEqual([
      s3.id,
      s2.id,
      s1.id
    ])
    // Ascending mode drives getTimeline via minStatusId with no max ceiling, and
    // never as sinceStatusId.
    expect(getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ minStatusId: 'floor', maxStatusId: null })
    )
    expect(getTimeline.mock.calls[0][0].sinceStatusId).toBeUndefined()
  })

  describe('animation metadata enrichment in timeline pages', () => {
    beforeEach(() => {
      clearAnimationMetadataCacheForTests()
      vi.mocked(getServerSoftware).mockReset()
      vi.mocked(safeRemoteFetch).mockReset()
      vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
    })

    afterEach(() => {
      clearAnimationMetadataCacheForTests()
    })

    it('enriches unclassified video attachment in descending timeline page', async () => {
      const att: Attachment = {
        id: 'att-1',
        actorId: 'https://mastodon.social/users/cheeaun',
        statusId: 'https://mastodon.social/users/cheeaun/statuses/111',
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/media/video-111.mp4',
        name: 'video-111',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const note: StatusNote = {
        id: 'https://mastodon.social/users/cheeaun/statuses/111',
        url: 'https://mastodon.social/@cheeaun/111',
        actorId: 'https://mastodon.social/users/cheeaun',
        actor: null,
        type: StatusType.enum.Note,
        text: 'Hello gif',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [att],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const updateAttachmentPlayback = vi.fn().mockResolvedValue(true)
      const database = {
        getTimeline: vi.fn(async () => [note]),
        getBlockRelations: vi.fn(async () => []),
        getMuteRelations: vi.fn(async () => []),
        getActorDomainBlocks: vi.fn(async () => []),
        getModerationStatesForActors: vi.fn(async () => new Map()),
        updateAttachmentPlayback
      } as unknown as Database

      vi.mocked(safeRemoteFetch).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: '111',
          uri: note.id,
          url: note.url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm111',
              type: 'gifv',
              url: att.url,
              preview_url: 'https://files.mastodon.social/media/preview-111.png'
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://mastodon.social/api/v1/statuses/111'
      })

      const page = await getFilteredTimelinePage({
        database,
        timeline: Timeline.MAIN,
        actorId: readerActorId,
        limit: 10
      })

      expect(page.statuses).toHaveLength(1)
      const firstStatus = page.statuses[0] as StatusNote
      expect(firstStatus.attachments[0].playbackType).toBe('gifv')
      expect(firstStatus.attachments[0].thumbnailUrl).toBe(
        'https://files.mastodon.social/media/preview-111.png'
      )
      expect(updateAttachmentPlayback).toHaveBeenCalledWith({
        id: 'att-1',
        playbackType: 'gifv',
        thumbnailUrl: 'https://files.mastodon.social/media/preview-111.png',
        onlyIfUnset: true
      })
    })

    it('enriches unclassified video attachment in ascending timeline page (minStatusId)', async () => {
      const att: Attachment = {
        id: 'att-asc-1',
        actorId: 'https://mastodon.social/users/cheeaun',
        statusId: 'https://mastodon.social/users/cheeaun/statuses/222',
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/media/video-222.mp4',
        name: 'video-222',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const note: StatusNote = {
        id: 'https://mastodon.social/users/cheeaun/statuses/222',
        url: 'https://mastodon.social/@cheeaun/222',
        actorId: 'https://mastodon.social/users/cheeaun',
        actor: null,
        type: StatusType.enum.Note,
        text: 'Ascending gif note',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [att],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const updateAttachmentPlayback = vi.fn().mockResolvedValue(true)
      const database = {
        getTimeline: vi.fn(async () => [note]),
        getBlockRelations: vi.fn(async () => []),
        getMuteRelations: vi.fn(async () => []),
        getActorDomainBlocks: vi.fn(async () => []),
        getModerationStatesForActors: vi.fn(async () => new Map()),
        updateAttachmentPlayback
      } as unknown as Database

      vi.mocked(safeRemoteFetch).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: '222',
          uri: note.id,
          url: note.url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm222',
              type: 'gifv',
              url: att.url,
              preview_url: 'https://files.mastodon.social/media/preview-222.png'
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://mastodon.social/api/v1/statuses/222'
      })

      const page = await getFilteredTimelinePage({
        database,
        timeline: Timeline.MAIN,
        actorId: readerActorId,
        minStatusId: 'cursor-lower',
        limit: 10
      })

      expect(page.statuses).toHaveLength(1)
      const firstStatus = page.statuses[0] as StatusNote
      expect(firstStatus.attachments[0].playbackType).toBe('gifv')
      expect(firstStatus.attachments[0].thumbnailUrl).toBe(
        'https://files.mastodon.social/media/preview-222.png'
      )
    })

    it('deduplicates repeated Announce originals across timeline rows and calls lookup once', async () => {
      const originalAtt: Attachment = {
        id: 'orig-att-1',
        actorId: 'https://mastodon.social/users/cheeaun',
        statusId: 'https://mastodon.social/users/cheeaun/statuses/333',
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/media/video-333.mp4',
        name: 'video-333',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const originalNote: StatusNote = {
        id: 'https://mastodon.social/users/cheeaun/statuses/333',
        url: 'https://mastodon.social/@cheeaun/333',
        actorId: 'https://mastodon.social/users/cheeaun',
        actor: null,
        type: StatusType.enum.Note,
        text: 'Original boosted note',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [originalAtt],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const boost1: StatusAnnounce = {
        id: 'https://llun.test/users/b1/statuses/boost-1',
        actorId: 'https://llun.test/users/b1',
        actor: null,
        type: StatusType.enum.Announce,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalStatus: originalNote
      }
      const boost2: StatusAnnounce = {
        id: 'https://llun.test/users/b2/statuses/boost-2',
        actorId: 'https://llun.test/users/b2',
        actor: null,
        type: StatusType.enum.Announce,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: true,
        createdAt: Date.now() + 1,
        updatedAt: Date.now() + 1,
        originalStatus: { ...originalNote, attachments: [{ ...originalAtt }] }
      }

      const database = {
        getTimeline: vi.fn(async () => [boost2, boost1]),
        getBlockRelations: vi.fn(async () => []),
        getMuteRelations: vi.fn(async () => []),
        getActorDomainBlocks: vi.fn(async () => []),
        getModerationStatesForActors: vi.fn(async () => new Map()),
        updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
      } as unknown as Database

      vi.mocked(safeRemoteFetch).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: '333',
          uri: originalNote.id,
          url: originalNote.url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm333',
              type: 'gifv',
              url: originalAtt.url,
              preview_url: 'https://files.mastodon.social/media/preview-333.png'
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://mastodon.social/api/v1/statuses/333'
      })

      const page = await getFilteredTimelinePage({
        database,
        timeline: Timeline.MAIN,
        actorId: readerActorId,
        limit: 10
      })

      expect(page.statuses).toHaveLength(2)
      // Only 1 remote fetch call made
      expect(safeRemoteFetch).toHaveBeenCalledTimes(1)

      const b2 = page.statuses[0] as StatusAnnounce
      const b1 = page.statuses[1] as StatusAnnounce
      expect(
        (b2.originalStatus as StatusNote).attachments[0].playbackType
      ).toBe('gifv')
      expect(
        (b1.originalStatus as StatusNote).attachments[0].playbackType
      ).toBe('gifv')
    })

    it('does not lookup metadata for posts filtered out by blocks or mutes', async () => {
      const att: Attachment = {
        id: 'att-filtered',
        actorId: blockedActorId,
        statusId: 'https://blocked.test/users/blocked/statuses/blocked-1',
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://blocked.test/media/video.mp4',
        name: 'blocked video',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const blockedNote: StatusNote = {
        id: 'https://blocked.test/users/blocked/statuses/blocked-1',
        url: 'https://blocked.test/@blocked/blocked-1',
        actorId: blockedActorId,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Blocked note',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [att],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const database = {
        getTimeline: vi.fn(async () => [blockedNote]),
        getBlockRelations: vi.fn(async () => [
          {
            actorId: readerActorId,
            targetActorId: blockedActorId,
            createdAt: Date.now()
          }
        ]),
        getMuteRelations: vi.fn(async () => []),
        getActorDomainBlocks: vi.fn(async () => []),
        getModerationStatesForActors: vi.fn(async () => new Map()),
        updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
      } as unknown as Database

      const page = await getFilteredTimelinePage({
        database,
        timeline: Timeline.MAIN,
        actorId: readerActorId,
        limit: 10
      })

      expect(page.statuses).toHaveLength(0)
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('leaves ordinary video attachments manual when remote source reports video', async () => {
      const att: Attachment = {
        id: 'att-video-only',
        actorId: 'https://mastodon.social/users/cheeaun',
        statusId: 'https://mastodon.social/users/cheeaun/statuses/444',
        type: 'Document',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/media/real-video.mp4',
        name: 'Real video',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const note: StatusNote = {
        id: 'https://mastodon.social/users/cheeaun/statuses/444',
        url: 'https://mastodon.social/@cheeaun/444',
        actorId: 'https://mastodon.social/users/cheeaun',
        actor: null,
        type: StatusType.enum.Note,
        text: 'Real video note',
        summary: null,
        reply: '',
        replies: [],
        totalReplies: 0,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        to: [],
        cc: [],
        edits: [],
        attachments: [att],
        tags: [],
        isLocalActor: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const database = {
        getTimeline: vi.fn(async () => [note]),
        getBlockRelations: vi.fn(async () => []),
        getMuteRelations: vi.fn(async () => []),
        getActorDomainBlocks: vi.fn(async () => []),
        getModerationStatesForActors: vi.fn(async () => new Map()),
        updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
      } as unknown as Database

      vi.mocked(safeRemoteFetch).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: '444',
          uri: note.id,
          url: note.url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm444',
              type: 'video',
              url: att.url
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://mastodon.social/api/v1/statuses/444'
      })

      const page = await getFilteredTimelinePage({
        database,
        timeline: Timeline.MAIN,
        actorId: readerActorId,
        limit: 10
      })

      expect(page.statuses).toHaveLength(1)
      const firstStatus = page.statuses[0] as StatusNote
      expect(firstStatus.attachments[0].playbackType).toBe('video')
    })
  })
})
