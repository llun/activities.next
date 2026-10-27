import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import {
  UNDATED_DAY_KEY,
  formatDayHeading,
  formatDayMeta,
  formatDayToastPhrase,
  getGalleryDayKey,
  getSelectDayAction,
  groupGalleryItemsByDay
} from '@/lib/components/gallery/galleryDayGroups'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { withTimeZone } from '@/lib/testing/withTimeZone'

const item = (
  mediaId: string,
  overrides: Partial<GalleryItemEntity>
): GalleryItemEntity => buildGalleryItem(mediaId, overrides)

describe('getGalleryDayKey', () => {
  it.each([
    {
      label: 'dated under a date sort is its UTC camera day',
      sort: 'taken_desc' as const,
      overrides: {
        takenAt: '2025-10-12T10:15:00.000Z',
        uploadedAt: '2025-10-20T09:00:00.000Z'
      },
      expected: '2025-10-12'
    },
    {
      label: 'dateless under a date sort is its upload day',
      sort: 'taken_desc' as const,
      overrides: { takenAt: null, uploadedAt: '2025-10-03T08:00:00.000Z' },
      expected: 'uploaded:2025-10-03'
    },
    {
      label: 'any photo under sort=uploaded is its upload day',
      sort: 'uploaded' as const,
      overrides: {
        takenAt: '2025-10-12T10:15:00.000Z',
        uploadedAt: '2025-10-20T09:00:00.000Z'
      },
      expected: 'uploaded:2025-10-20'
    },
    {
      label: '23:59:59Z stays on that UTC day',
      sort: 'taken_desc' as const,
      overrides: { takenAt: '2025-10-04T23:59:59.999Z' },
      expected: '2025-10-04'
    },
    {
      label: 'a +02:00 ISO that crosses midnight is the earlier UTC day',
      sort: 'taken_desc' as const,
      overrides: { takenAt: '2025-10-04T00:30:00+02:00' },
      expected: '2025-10-03'
    },
    {
      label: 'an unparsable takenAt falls back to the upload day',
      sort: 'taken_desc' as const,
      overrides: { takenAt: 'not a date', uploadedAt: '2025-10-03T08:00:00Z' },
      expected: 'uploaded:2025-10-03'
    },
    {
      label: 'neither date parsing is null',
      sort: 'taken_desc' as const,
      overrides: { takenAt: null, uploadedAt: null },
      expected: null
    }
  ])('$label', ({ sort, overrides, expected }) => {
    expect(getGalleryDayKey(item('m1', overrides), sort)).toBe(expected)
  })

  it('treats the epoch timestamp as a dated camera day', () => {
    const epochItem = {
      ...item('epoch', { takenAt: null }),
      takenAt: 0
    } as unknown as GalleryItemEntity

    expect(getGalleryDayKey(epochItem, 'taken_desc')).toBe('1970-01-01')
  })
})

describe('groupGalleryItemsByDay', () => {
  it('keeps first-seen order and merges a key that reappears after another', () => {
    const groups = groupGalleryItemsByDay(
      [
        item('a', { takenAt: '2025-10-12T10:00:00Z' }),
        item('b', { takenAt: '2025-10-11T10:00:00Z' }),
        item('c', { takenAt: '2025-10-12T15:00:00Z' })
      ],
      'taken_desc'
    )

    expect(groups.map((group) => group.key)).toEqual([
      '2025-10-12',
      '2025-10-11'
    ])
    expect(groups[0].items.map((entry) => entry.mediaId)).toEqual(['a', 'c'])
    expect(groups[1].items.map((entry) => entry.mediaId)).toEqual(['b'])
  })

  it('merges a dated and a dateless photo of the same day only by equal key', () => {
    const groups = groupGalleryItemsByDay(
      [
        item('dated', { takenAt: '2025-10-12T10:00:00Z' }),
        item('dateless', {
          takenAt: null,
          uploadedAt: '2025-10-12T18:00:00Z'
        }),
        item('dated-again', { takenAt: '2025-10-12T12:00:00Z' })
      ],
      'taken_desc'
    )

    expect(groups.map((group) => group.key)).toEqual([
      '2025-10-12',
      'uploaded:2025-10-12'
    ])
    expect(groups[0].items.map((entry) => entry.mediaId)).toEqual([
      'dated',
      'dated-again'
    ])
    expect(groups[1].items.map((entry) => entry.mediaId)).toEqual(['dateless'])
  })

  it('puts null keys last under UNDATED_DAY_KEY', () => {
    const groups = groupGalleryItemsByDay(
      [
        item('dated', { takenAt: '2025-10-12T10:00:00Z' }),
        item('unknown', { takenAt: null, uploadedAt: null }),
        item('dated-again', { takenAt: '2025-10-11T10:00:00Z' })
      ],
      'taken_desc'
    )

    expect(groups.map((group) => group.key)).toEqual([
      '2025-10-12',
      '2025-10-11',
      UNDATED_DAY_KEY
    ])
    expect(groups[2].items.map((entry) => entry.mediaId)).toEqual(['unknown'])
  })
})

describe('formatDayHeading', () => {
  it.each([
    { key: '2025-10-12', short: false, expected: 'Sun 12 Oct 2025' },
    { key: '2025-10-12', short: true, expected: 'Sun 12 Oct' },
    {
      key: 'uploaded:2025-10-03',
      short: false,
      expected: 'Uploaded Fri 3 Oct 2025'
    },
    { key: 'uploaded:2025-10-03', short: true, expected: 'Uploaded Fri 3 Oct' },
    { key: UNDATED_DAY_KEY, short: false, expected: 'No date' },
    { key: UNDATED_DAY_KEY, short: true, expected: 'No date' }
  ])('$key short=$short', ({ key, short, expected }) => {
    expect(formatDayHeading(key, { short })).toBe(expected)
  })
})

describe('formatDayMeta', () => {
  it.each([
    {
      label: 'place, count and picked',
      input: {
        placeName: 'Box Hill, Surrey',
        count: 14,
        picked: 2,
        inAlbum: 0,
        selecting: true
      },
      expected: 'Box Hill, Surrey · 14 photos · 2 picked'
    },
    {
      label: 'short drops the word photos',
      input: {
        placeName: 'Box Hill, Surrey',
        count: 14,
        picked: 2,
        inAlbum: 0,
        selecting: true,
        short: true
      },
      expected: 'Box Hill, Surrey · 14 · 2 picked'
    },
    {
      label: 'not selecting shows no picked part',
      input: {
        placeName: 'Skomer Island',
        count: 27,
        picked: 0,
        inAlbum: 0,
        selecting: false,
        short: true
      },
      expected: 'Skomer Island · 27'
    },
    {
      label: 'no place, short',
      input: {
        placeName: null,
        count: 14,
        picked: 2,
        inAlbum: 0,
        selecting: true,
        short: true
      },
      expected: '14 · 2 picked'
    },
    {
      label: 'all picked',
      input: {
        placeName: null,
        count: 6,
        picked: 6,
        inAlbum: 0,
        selecting: true,
        short: true
      },
      expected: '6 · all picked'
    },
    {
      label: 'all in album',
      input: {
        placeName: null,
        count: 8,
        picked: 0,
        inAlbum: 8,
        selecting: true,
        short: true
      },
      expected: '8 · 8 in album'
    },
    {
      label: 'zero parts are left out',
      input: {
        placeName: null,
        count: 5,
        picked: 0,
        inAlbum: 0,
        selecting: true
      },
      expected: '5 photos'
    },
    {
      label: 'one photo is singular',
      input: {
        placeName: 'Skomer Island',
        count: 1,
        picked: 0,
        inAlbum: 0,
        selecting: false
      },
      expected: 'Skomer Island · 1 photo'
    },
    {
      label: 'picked and in album together',
      input: {
        placeName: null,
        count: 10,
        picked: 2,
        inAlbum: 3,
        selecting: true,
        short: true
      },
      expected: '10 · 2 picked · 3 in album'
    }
  ])('$label', ({ input, expected }) => {
    expect(formatDayMeta(input)).toBe(expected)
  })
})

describe('getSelectDayAction', () => {
  it.each([
    {
      label: 'rule 1: every match already in the album',
      input: { count: 8, inAlbum: 8, picked: 0, room: 100, hasAlbum: true },
      expected: {
        kind: 'select',
        label: 'All in album',
        short: 'All in album',
        disabled: true,
        take: 0
      }
    },
    {
      label: 'rule 2: every pickable photo picked',
      input: { count: 6, inAlbum: 0, picked: 6, room: 100, hasAlbum: false },
      expected: {
        kind: 'deselect',
        label: 'Deselect day',
        short: 'Deselect day',
        disabled: false,
        take: 0
      }
    },
    {
      label: 'rule 3: the album is full',
      input: { count: 118, inAlbum: 0, picked: 0, room: 0, hasAlbum: true },
      expected: {
        kind: 'select',
        label: 'Album full',
        short: 'Album full',
        disabled: true,
        take: 0
      }
    },
    {
      label: 'rule 4: room left caps the take',
      input: { count: 118, inAlbum: 0, picked: 0, room: 40, hasAlbum: true },
      expected: {
        kind: 'select',
        label: 'Select 40 (room left)',
        short: 'Select 40',
        disabled: false,
        take: 40
      }
    },
    {
      label: 'rule 5: nothing picked yet',
      input: { count: 14, inAlbum: 0, picked: 0, room: null, hasAlbum: false },
      expected: {
        kind: 'select',
        label: 'Select day',
        short: 'Select day',
        disabled: false,
        take: 14
      }
    },
    {
      label: 'rule 6: some picked already',
      input: { count: 14, inAlbum: 0, picked: 2, room: null, hasAlbum: false },
      expected: {
        kind: 'select',
        label: 'Select 12 more',
        short: 'Select 12',
        disabled: false,
        take: 12
      }
    },
    {
      label: 'count 0 with an album is All in album',
      input: { count: 0, inAlbum: 0, picked: 0, room: 100, hasAlbum: true },
      expected: {
        kind: 'select',
        label: 'All in album',
        short: 'All in album',
        disabled: true,
        take: 0
      }
    },
    {
      label: 'count 0 without an album is a disabled Select day',
      input: { count: 0, inAlbum: 0, picked: 0, room: 100, hasAlbum: false },
      expected: {
        kind: 'select',
        label: 'Select day',
        short: 'Select day',
        disabled: true,
        take: 0
      }
    },
    {
      label: 'count 0 with no room is still a disabled Select day',
      input: { count: 0, inAlbum: 0, picked: 0, room: 0, hasAlbum: false },
      expected: {
        kind: 'select',
        label: 'Select day',
        short: 'Select day',
        disabled: true,
        take: 0
      }
    },
    {
      label: 'numbers are grouped',
      input: {
        count: 1300,
        inAlbum: 0,
        picked: 100,
        room: null,
        hasAlbum: false
      },
      expected: {
        kind: 'select',
        label: 'Select 1,200 more',
        short: 'Select 1,200',
        disabled: false,
        take: 1200
      }
    }
  ])('$label', ({ input, expected }) => {
    expect(getSelectDayAction(input)).toEqual(expected)
  })

  it('formats a room-capped take with grouping', () => {
    expect(
      getSelectDayAction({
        count: 2000,
        inAlbum: 0,
        picked: 0,
        room: 1500,
        hasAlbum: true
      })
    ).toEqual({
      kind: 'select',
      label: 'Select 1,500 (room left)',
      short: 'Select 1,500',
      disabled: false,
      take: 1500
    })
  })
})

describe('formatDayToastPhrase', () => {
  it('says from a dated day', () => {
    expect(formatDayToastPhrase('2025-10-04')).toBe('from Sat 4 Oct 2025')
  })

  it('drops the from of an upload-day group, whose heading says Uploaded', () => {
    expect(formatDayToastPhrase('uploaded:2026-10-24')).toBe(
      'uploaded Sat 24 Oct 2026'
    )
  })
})

// The suite runs pinned to UTC; these run the same assertions in zones where
// the local day of both instants differs from the UTC day, so a local Date
// getter anywhere in the key or the heading would fail them.
describe('UTC day keys and headings away from UTC', () => {
  const edges = ['2025-10-04T23:30:00.000Z', '2025-10-04T00:30:00.000Z']

  it.each([['America/Los_Angeles'], ['Pacific/Auckland']])(
    'keys both edges of 2025-10-04 by UTC day in %s',
    async (timeZone) => {
      await withTimeZone(timeZone, () => {
        for (const takenAt of edges) {
          expect(
            getGalleryDayKey(item('edge-1', { takenAt }), 'taken_desc')
          ).toBe('2025-10-04')
          expect(
            getGalleryDayKey(
              item('edge-2', { uploadedAt: takenAt }),
              'uploaded'
            )
          ).toBe('uploaded:2025-10-04')
        }
        expect(formatDayHeading('2025-10-04')).toBe('Sat 4 Oct 2025')
        expect(formatDayHeading('2025-10-04', { short: true })).toBe(
          'Sat 4 Oct'
        )
      })
    }
  )
})
