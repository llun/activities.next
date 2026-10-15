import { describe, expect, it } from 'vitest'

import { Status, StatusType } from '@/lib/types/domain/status'

import {
  appendOlderPageToSegments,
  mergeFreshPageIntoSegments,
  mergeGapPageIntoSegments,
  reconcileSegmentsWithServerBatch,
  trimSegmentsToMax
} from './mergeTimelineSegments'
import { HydratedTimelineSegment } from './types'

const mockNote = (
  id: string,
  text = 'hello',
  attachments: {
    id?: string
    url?: string
    playbackType?: string
    thumbnailUrl?: string
  }[] = []
): Status =>
  ({
    id,
    type: StatusType.enum.Note,
    actorId: 'https://llun.test/users/alice',
    text,
    attachments: attachments.map((att) => ({
      id: att.id || `${id}-att`,
      type: 'image',
      url: att.url || `https://media.test/${id}.jpg`,
      playbackType: att.playbackType,
      thumbnailUrl: att.thumbnailUrl
    }))
  }) as unknown as Status

const mockAnnounce = (
  id: string,
  originalStatus: Status,
  actorId = 'https://llun.test/users/bob'
): Status =>
  ({
    id,
    type: StatusType.enum.Announce,
    actorId,
    originalStatus
  }) as unknown as Status

describe('mergeFreshPageIntoSegments', () => {
  it('returns current segments unchanged when incomingStatuses is empty', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1'), mockNote('s2')],
        nextMaxStatusId: 's2',
        prevMinStatusId: 's1'
      }
    ]

    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: [],
      incomingNextMaxStatusId: 's0'
    })

    expect(result.segments).toBe(currentSegments)
    expect(result.statuses.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.hasGap).toBe(false)
    expect(result.addedNewerCount).toBe(0)
  })

  it('creates a single initial segment when currentSegments is empty', () => {
    const incoming = [mockNote('s1'), mockNote('s2')]
    const result = mergeFreshPageIntoSegments({
      currentSegments: [],
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 's2',
      incomingPrevMinStatusId: 's1'
    })

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.segments[0].nextMaxStatusId).toBe('s2')
    expect(result.segments[0].prevMinStatusId).toBe('s1')
    expect(result.hasGap).toBe(false)
    expect(result.addedNewerCount).toBe(2)
  })

  it('prepends newer statuses and updates overlapping statuses when overlap exists', () => {
    // Current top segment has s2 and s3. s2 had resolved playbackType
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [
          mockNote('s2', 'cached s2', [
            { playbackType: 'video/mp4', thumbnailUrl: 'https://thumb.test/2' }
          ]),
          mockNote('s3', 'cached s3')
        ],
        nextMaxStatusId: 'cursor-after-s3',
        prevMinStatusId: 's2'
      }
    ]

    // Incoming has s1 (new), s2 (updated fresh from server with empty playbackType)
    const incoming = [
      mockNote('s1', 'fresh s1'),
      mockNote('s2', 'fresh s2 text', [{ id: 's2-att' }])
    ]

    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 's2'
    })

    expect(result.hasGap).toBe(false)
    expect(result.addedNewerCount).toBe(1)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3'
    ])
    // Preserves s2's playbackType via reconcileStatusesMetadata
    const mergedS2 = result.segments[0].statuses[1]
    if ('text' in mergedS2) {
      expect(mergedS2.text).toBe('fresh s2 text')
    }
    expect(
      'attachments' in mergedS2 && mergedS2.attachments?.[0]?.playbackType
    ).toBe('video/mp4')
    expect(
      'attachments' in mergedS2 && mergedS2.attachments?.[0]?.thumbnailUrl
    ).toBe('https://thumb.test/2')
    // Preserves nextMaxStatusId of top segment
    expect(result.segments[0].nextMaxStatusId).toBe('cursor-after-s3')
  })

  it('detects overlap via incomingNextMaxStatusId cursor adjacency', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s2')],
        nextMaxStatusId: 's3',
        prevMinStatusId: 's2'
      }
    ]

    // incomingNextMaxStatusId points directly to s2 (the top status of current)
    const incoming = [mockNote('s1')]
    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 's2'
    })

    expect(result.hasGap).toBe(false)
    expect(result.addedNewerCount).toBe(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('bridges a gap between segment 0 and segment 1 when incoming extends into segment 1', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s2')],
        nextMaxStatusId: 'gap-cursor',
        prevMinStatusId: 's2'
      },
      {
        statuses: [mockNote('s4'), mockNote('s5')],
        nextMaxStatusId: 'end-cursor',
        prevMinStatusId: 's4'
      }
    ]

    // Incoming has s1, s2, s3, s4 (reaches all the way to s4 in segment 1!)
    const incoming = [
      mockNote('s1'),
      mockNote('s2'),
      mockNote('s3'),
      mockNote('s4')
    ]

    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 'cursor-after-s4'
    })

    expect(result.hasGap).toBe(false)
    // The two segments should be collapsed into one!
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5'
    ])
    expect(result.segments[0].nextMaxStatusId).toBe('end-cursor')
  })

  it('creates a new top segment and marks hasGap: true when no overlap exists', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s10'), mockNote('s11')],
        nextMaxStatusId: 's12',
        prevMinStatusId: 's10'
      }
    ]

    const incoming = [mockNote('s1'), mockNote('s2')]
    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 'gap-cursor'
    })

    expect(result.hasGap).toBe(true)
    expect(result.addedNewerCount).toBe(2)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.segments[1].statuses.map((s) => s.id)).toEqual(['s10', 's11'])
  })

  it('keeps the whole tail when a fresh merge runs over a list longer than the offline cache cap', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i + 2}`)
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: ids.map((id) => mockNote(id)),
        nextMaxStatusId: 'tail-cursor',
        prevMinStatusId: 's2'
      }
    ]

    const result = mergeFreshPageIntoSegments({
      currentSegments,
      incomingStatuses: [mockNote('s1'), mockNote('s2')],
      incomingNextMaxStatusId: 's2'
    })

    expect(result.segments).toHaveLength(1)
    expect(result.statuses).toHaveLength(251)
    expect(result.segments[0].statuses[0].id).toBe('s1')
    expect(result.segments[0].statuses.at(-1)?.id).toBe('s251')
    expect(result.segments[0].nextMaxStatusId).toBe('tail-cursor')
  })
})

describe('mergeGapPageIntoSegments', () => {
  it('keeps every status when a gap merge runs over a list longer than the offline cache cap', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: Array.from({ length: 150 }, (_, i) => mockNote(`a${i}`)),
        nextMaxStatusId: 'gap-cursor',
        prevMinStatusId: 'a0'
      },
      {
        statuses: Array.from({ length: 100 }, (_, i) => mockNote(`z${i}`)),
        nextMaxStatusId: 'end-cursor',
        prevMinStatusId: 'z0'
      }
    ]

    const result = mergeGapPageIntoSegments({
      currentSegments,
      segmentIndex: 0,
      incomingStatuses: [mockNote('m1'), mockNote('m2')],
      incomingNextMaxStatusId: 'still-gap'
    })

    expect(result.statuses).toHaveLength(252)
    expect(result.segments.at(-1)?.statuses.at(-1)?.id).toBe('z99')
  })

  it('appends incoming statuses to the target segment without bridging if gap remains', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1')],
        nextMaxStatusId: 'gap-cursor-1',
        prevMinStatusId: 's1'
      },
      {
        statuses: [mockNote('s10')],
        nextMaxStatusId: 'end-cursor',
        prevMinStatusId: 's10'
      }
    ]

    const incoming = [mockNote('s2')]
    const result = mergeGapPageIntoSegments({
      currentSegments,
      segmentIndex: 0,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 'gap-cursor-2'
    })

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.segments[0].nextMaxStatusId).toBe('gap-cursor-2')
    expect(result.segments[1].statuses.map((s) => s.id)).toEqual(['s10'])
  })

  it('bridges with the next segment when incoming touches the next segment', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1')],
        nextMaxStatusId: 'gap-cursor',
        prevMinStatusId: 's1'
      },
      {
        statuses: [mockNote('s3'), mockNote('s4')],
        nextMaxStatusId: 'end-cursor',
        prevMinStatusId: 's3'
      }
    ]

    // incoming fills s2 and s3 (touching segment 1!)
    const incoming = [mockNote('s2'), mockNote('s3')]
    const result = mergeGapPageIntoSegments({
      currentSegments,
      segmentIndex: 0,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 'after-s3'
    })

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
      's4'
    ])
    expect(result.segments[0].nextMaxStatusId).toBe('end-cursor')
  })

  it('bridges with the next segment when incomingNextMaxStatusId is null', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1')],
        nextMaxStatusId: 'gap-cursor',
        prevMinStatusId: 's1'
      },
      {
        statuses: [mockNote('s3')],
        nextMaxStatusId: 'end-cursor',
        prevMinStatusId: 's3'
      }
    ]

    // server returns s2 with null nextMaxStatusId (no more older posts in gap)
    const incoming = [mockNote('s2')]
    const result = mergeGapPageIntoSegments({
      currentSegments,
      segmentIndex: 0,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: null
    })

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3'
    ])
    expect(result.segments[0].nextMaxStatusId).toBe('end-cursor')
  })
})

describe('appendOlderPageToSegments', () => {
  it('appends past the offline cache cap and keeps the incoming cursor', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: Array.from({ length: 200 }, (_, i) => mockNote(`a${i}`)),
        nextMaxStatusId: 'cursor-200',
        prevMinStatusId: 'a0'
      }
    ]

    const result = appendOlderPageToSegments({
      currentSegments,
      incomingStatuses: Array.from({ length: 30 }, (_, i) => mockNote(`b${i}`)),
      incomingNextMaxStatusId: 'cursor-230'
    })

    expect(result.statuses).toHaveLength(230)
    expect(result.segments[0].statuses).toHaveLength(230)
    expect(result.segments[0].nextMaxStatusId).toBe('cursor-230')
  })

  it('appends older statuses to the last segment and updates nextMaxStatusId', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1')],
        nextMaxStatusId: 's2',
        prevMinStatusId: 's1'
      }
    ]

    const incoming = [mockNote('s2'), mockNote('s3')]
    const result = appendOlderPageToSegments({
      currentSegments,
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 's4'
    })

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3'
    ])
    expect(result.segments[0].nextMaxStatusId).toBe('s4')
  })

  it('creates single segment if currentSegments was empty', () => {
    const incoming = [mockNote('s1')]
    const result = appendOlderPageToSegments({
      currentSegments: [],
      incomingStatuses: incoming,
      incomingNextMaxStatusId: 's2'
    })

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1'])
  })
})

describe('reconcileSegmentsWithServerBatch', () => {
  it('removes deleted statuses and boosts of deleted statuses', () => {
    const s1 = mockNote('s1')
    const s2 = mockNote('s2')
    const boostOfS2 = mockAnnounce('boost-s2', s2)
    const s3 = mockNote('s3')

    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [s1, boostOfS2, s3],
        nextMaxStatusId: null,
        prevMinStatusId: 's1'
      }
    ]

    const result = reconcileSegmentsWithServerBatch({
      currentSegments,
      updatedStatuses: [],
      removedStatusIds: ['s2', 's3']
    })

    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s1'])
  })

  it('updates matching statuses in place while preserving attachment metadata', () => {
    const cachedNote = mockNote('s1', 'old text', [
      { playbackType: 'video/mp4', thumbnailUrl: 'https://thumb.test/1' }
    ])
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [cachedNote],
        nextMaxStatusId: null,
        prevMinStatusId: 's1'
      }
    ]

    const updatedNote = mockNote('s1', 'updated text', [{ id: 's1-att' }])
    const result = reconcileSegmentsWithServerBatch({
      currentSegments,
      updatedStatuses: [updatedNote],
      removedStatusIds: []
    })

    const status = result.segments[0].statuses[0]
    if ('text' in status) {
      expect(status.text).toBe('updated text')
    }
    expect(
      'attachments' in status && status.attachments?.[0]?.playbackType
    ).toBe('video/mp4')
  })

  it('drops empty segments unless only one segment remains', () => {
    const currentSegments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1')],
        nextMaxStatusId: null,
        prevMinStatusId: 's1'
      },
      {
        statuses: [mockNote('s2')],
        nextMaxStatusId: null,
        prevMinStatusId: 's2'
      }
    ]

    const result = reconcileSegmentsWithServerBatch({
      currentSegments,
      updatedStatuses: [],
      removedStatusIds: ['s1']
    })

    // Segment 0 was emptied, so it is dropped. Only Segment 1 remains.
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].statuses.map((s) => s.id)).toEqual(['s2'])
  })
})

describe('trimSegmentsToMax', () => {
  it('trims oldest statuses from tail across multiple segments', () => {
    const segments: HydratedTimelineSegment[] = [
      {
        statuses: [mockNote('s1'), mockNote('s2')],
        nextMaxStatusId: 'gap',
        prevMinStatusId: 's1'
      },
      {
        statuses: [mockNote('s3'), mockNote('s4'), mockNote('s5')],
        nextMaxStatusId: 'end',
        prevMinStatusId: 's3'
      }
    ]

    const trimmed = trimSegmentsToMax(segments, 3)
    expect(trimmed).toHaveLength(2)
    expect(trimmed[0].statuses.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(trimmed[1].statuses.map((s) => s.id)).toEqual(['s3'])
    expect(trimmed[1].nextMaxStatusId).toBe('s3')
  })
})
