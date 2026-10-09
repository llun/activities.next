import { buildIndexRow } from '@/lib/services/gallery/__fixtures__/galleryIndexRow'
import {
  clusterTrips,
  compareNewestFirst,
  groupPhotosByDay,
  groupSpecies,
  isCoveredByOneAlbum,
  photoActivityDays,
  toLocalDayKey,
  toUtcDayKey,
  toUtcDayNumber
} from '@/lib/services/gallery/galleryAlbumSuggestionGroups'
import { withTimeZone } from '@/lib/testing/withTimeZone'

const DAY = 24 * 60 * 60 * 1000
const SEP_12 = Date.UTC(2026, 8, 12)

// `count` photos on each of the given days (offsets from 12 Sep, UTC noon).
const photosOn = (days: number[], perDay = 1, firstId = 1) => {
  let id = firstId
  return days.flatMap((offset) =>
    Array.from({ length: perDay }, () =>
      buildIndexRow(id++, { takenAt: SEP_12 + offset * DAY + 12 * 3600_000 })
    )
  )
}

const options = { maxGapDays: 3, minPhotos: 4 }

describe('clusterTrips', () => {
  it('keeps photos whose neighbouring days are exactly the maximum gap apart together', () => {
    // 12 Sep, then 15 Sep: three days apart, so one trip.
    const clusters = clusterTrips(photosOn([0, 0, 3, 3]), options)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(4)
  })

  it('splits where the gap is one day past the maximum', () => {
    // 12 Sep and 16 Sep: four days apart.
    const clusters = clusterTrips(photosOn([0, 0, 0, 0, 4, 4, 4, 4]), options)

    expect(clusters).toHaveLength(2)
    expect(clusters.map((cluster) => cluster.length)).toEqual([4, 4])
  })

  it('measures the gap in calendar days, not hours', () => {
    // 23:30 on the 12th to 00:30 on the 16th is 3 days 1 hour but 4 calendar
    // days; 00:30 on the 12th to 23:30 on the 15th is 3 days 23 hours and 3
    // calendar days. Only the first splits.
    const late = (day: number, hour: number, minute: number, id: number) =>
      buildIndexRow(id, {
        takenAt: Date.UTC(2026, 8, day, hour, minute)
      })
    const splits = clusterTrips(
      [
        late(12, 23, 30, 1),
        late(12, 23, 31, 2),
        late(16, 0, 30, 3),
        late(16, 0, 31, 4)
      ],
      { maxGapDays: 3, minPhotos: 2 }
    )
    const stays = clusterTrips(
      [
        late(12, 0, 30, 1),
        late(12, 0, 31, 2),
        late(15, 23, 30, 3),
        late(15, 23, 31, 4)
      ],
      { maxGapDays: 3, minPhotos: 2 }
    )

    expect(splits).toHaveLength(2)
    expect(stays).toHaveLength(1)
  })

  it('drops runs below the minimum size and keeps those at it', () => {
    const clusters = clusterTrips(
      [...photosOn([0, 0, 0, 1]), ...photosOn([10, 10, 10], 1, 100)],
      options
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(4)
  })

  it('clusters the same photos whatever order they arrive in', () => {
    const rows = photosOn([0, 1, 2, 3, 9, 10, 11, 12])
    const shuffled = [...rows].reverse()

    const sizes = (clusters: unknown[][]) => clusters.map((c) => c.length)
    expect(sizes(clusterTrips(shuffled, options))).toEqual(
      sizes(clusterTrips(rows, options))
    )
    expect(sizes(clusterTrips(rows, options))).toEqual([4, 4])
  })

  it('skips photos with no capture date', () => {
    const undated = Array.from({ length: 10 }, (_, index) =>
      buildIndexRow(500 + index, { takenAt: null })
    )

    expect(clusterTrips(undated, options)).toEqual([])
    expect(
      clusterTrips([...undated, ...photosOn([0, 0, 0, 0])], options)
    ).toHaveLength(1)
  })

  it('cuts days at UTC midnight, whatever the machine time zone is', async () => {
    // One minute either side of UTC midnight: two different days everywhere.
    const rows = [
      buildIndexRow(1, { takenAt: Date.UTC(2026, 8, 12, 23, 59) }),
      buildIndexRow(2, { takenAt: Date.UTC(2026, 8, 13, 0, 1) })
    ]
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      await withTimeZone(zone, () => {
        expect(toUtcDayKey(rows[0].takenAt as number)).toBe('2026-09-12')
        expect(toUtcDayKey(rows[1].takenAt as number)).toBe('2026-09-13')
        expect(
          toUtcDayNumber(rows[1].takenAt as number) -
            toUtcDayNumber(rows[0].takenAt as number)
        ).toBe(1)
        expect(
          clusterTrips([...rows, ...photosOn([0, 0], 1, 10)], {
            maxGapDays: 3,
            minPhotos: 2
          })
        ).toHaveLength(1)
      })
    }
  })

  it('has no day for an instant that is not a date', () => {
    expect(toUtcDayKey(Number.NaN)).toBeNull()
    expect(toUtcDayKey(8.64e15 + 1)).toBeNull()
    expect(toLocalDayKey(Number.NaN, 'Asia/Tokyo')).toBeNull()
    expect(toLocalDayKey(Date.UTC(2026, 8, 12), 'Not/AZone')).toBeNull()
  })
})

describe('photoActivityDays', () => {
  // 05:00 on 13 Sep in Tokyo is 20:00 UTC on the 12th.
  const instant = Date.UTC(2026, 8, 12, 20, 0)

  it('lists the UTC day and the viewer-local day of a photo taken near midnight', () => {
    const rows = [buildIndexRow(1, { takenAt: instant })]

    expect(photoActivityDays('2026-09-12', rows, 'Asia/Tokyo')).toEqual([
      '2026-09-12',
      '2026-09-13'
    ])
  })

  it('is the UTC day alone when both readings agree', () => {
    const rows = [buildIndexRow(1, { takenAt: Date.UTC(2026, 8, 12, 3, 0) })]

    expect(photoActivityDays('2026-09-12', rows, 'Asia/Tokyo')).toEqual([
      '2026-09-12'
    ])
  })

  it('does not depend on the machine time zone', async () => {
    const rows = [buildIndexRow(1, { takenAt: instant })]
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
      await withTimeZone(zone, () => {
        expect(photoActivityDays('2026-09-12', rows, 'Asia/Tokyo')).toEqual([
          '2026-09-12',
          '2026-09-13'
        ])
        expect(
          photoActivityDays('2026-09-12', rows, 'America/Los_Angeles')
        ).toEqual(['2026-09-12'])
      })
    }
  })

  it('skips photos with no capture date and an unusable zone', () => {
    const rows = [
      buildIndexRow(1, { takenAt: null }),
      buildIndexRow(2, { takenAt: instant })
    ]

    expect(photoActivityDays('2026-09-12', rows, 'Not/AZone')).toEqual([
      '2026-09-12'
    ])
  })
})

describe('trips and days are UTC days', () => {
  it('measures a trip gap between UTC days, as the album shows them', () => {
    // 05:00 on 13 Sep in Tokyo is 20:00 UTC on the 12th, and 10:00 on the 16th
    // is 01:00 UTC: four UTC days apart, so two trips.
    const early = Date.UTC(2026, 8, 12, 20, 0)
    const late = Date.UTC(2026, 8, 16, 1, 0)
    const pair = [
      buildIndexRow(1, { takenAt: early }),
      buildIndexRow(2, { takenAt: early + 60_000 }),
      buildIndexRow(3, { takenAt: late }),
      buildIndexRow(4, { takenAt: late + 60_000 })
    ]

    expect(clusterTrips(pair, { maxGapDays: 3, minPhotos: 2 })).toHaveLength(2)
  })

  it('groups photos by UTC day, so a late shot stays on its day', () => {
    const rows = [
      buildIndexRow(1, { takenAt: Date.UTC(2026, 8, 12, 14, 30) }),
      buildIndexRow(2, { takenAt: Date.UTC(2026, 8, 12, 15, 30) })
    ]

    expect([...groupPhotosByDay(rows, 2).keys()]).toEqual(['2026-09-12'])
  })
})

describe('groupSpecies', () => {
  const species = (id: number, name: string, scientific?: string) =>
    buildIndexRow(id, {
      subjectName: name,
      subjectScientificName: scientific ?? null
    })

  it('keeps a species at the threshold and drops one below it', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        species(i, 'Kingfisher', 'Alcedo atthis')
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        species(10 + i, 'Heron', 'Ardea cinerea')
      )
    ]

    const groups = groupSpecies(rows, 5)

    expect([...groups.keys()]).toEqual(['sci:alcedo atthis'])
    expect(groups.get('sci:alcedo atthis')).toHaveLength(5)
  })

  it('counts one species under several common names, and ignores photos with no subject', () => {
    const rows = [
      species(1, 'Kingfisher', 'Alcedo atthis'),
      species(2, 'Common kingfisher', 'alcedo atthis'),
      species(3, 'River kingfisher', 'Alcedo atthis'),
      ...Array.from({ length: 5 }, (_, i) => buildIndexRow(20 + i))
    ]

    const groups = groupSpecies(rows, 3)

    expect(groups.get('sci:alcedo atthis')).toHaveLength(3)
    expect(groups.size).toBe(1)
  })
})

describe('groupPhotosByDay', () => {
  it('groups by UTC date and keeps the days with enough photos', () => {
    const rows = [
      ...photosOn([0], 3),
      ...photosOn([1], 2, 10),
      buildIndexRow(99, { takenAt: null })
    ]

    const days = groupPhotosByDay(rows, 3)

    expect([...days.keys()]).toEqual(['2026-09-12'])
  })
})

describe('compareNewestFirst', () => {
  it('orders by capture date, then upload date, then media id', () => {
    const rows = [
      buildIndexRow(1, { takenAt: 100 }),
      buildIndexRow(2, { takenAt: null, createdAt: 300 }),
      buildIndexRow(4, { takenAt: 200 }),
      buildIndexRow(3, { takenAt: 200 })
    ]

    expect([...rows].sort(compareNewestFirst).map((row) => row.id)).toEqual([
      '2',
      '4',
      '3',
      '1'
    ])
  })
})

describe('isCoveredByOneAlbum', () => {
  const albums = new Map([
    ['a', new Set(['1', '2', '3'])],
    ['b', new Set(['3', '4', '5'])]
  ])

  it.each([
    { description: 'every id is in one album', ids: ['1', '3'], covered: true },
    {
      description: 'the ids are split across two albums',
      ids: ['1', '4'],
      covered: false
    },
    { description: 'one id is in no album', ids: ['1', '9'], covered: false },
    { description: 'there are no ids', ids: [], covered: true }
  ])('is $covered when $description', ({ ids, covered }) => {
    expect(isCoveredByOneAlbum(ids, albums)).toBe(covered)
  })

  it('is never covered when there are no albums', () => {
    expect(isCoveredByOneAlbum(['1'], new Map())).toBeFalse()
  })
})
