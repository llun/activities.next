import type { GalleryGearUsageRow } from '@/lib/database/sql/galleryMedia'
import {
  getGalleryGearOverview,
  getGalleryGearUsage,
  getMostUsedWith,
  reduceGalleryGearUsage
} from '@/lib/services/gallery/galleryGearUsage'

const row = (
  gearId: string,
  mediaId: string,
  overrides: Partial<GalleryGearUsageRow> = {}
): GalleryGearUsageRow => ({
  gearId,
  mediaId,
  inGallery: true,
  takenAt: null,
  createdAt: 1_000,
  ...overrides
})

describe('reduceGalleryGearUsage', () => {
  it('gives every asked-for gear an entry, empty when unused', () => {
    expect(reduceGalleryGearUsage([], ['a', 'b'])).toEqual(
      new Map([
        ['a', { photoCount: 0, firstUsedAt: null, lastUsedAt: null }],
        ['b', { photoCount: 0, firstUsedAt: null, lastUsedAt: null }]
      ])
    )
  })

  it('counts gallery media only but dates every posted media', () => {
    const usage = reduceGalleryGearUsage(
      [
        row('a', 'm1', { takenAt: 5_000 }),
        row('a', 'm2', { takenAt: 2_000, inGallery: false }),
        row('a', 'm3', { takenAt: 9_000 })
      ],
      ['a']
    )

    expect(usage.get('a')).toEqual({
      photoCount: 2,
      firstUsedAt: 2_000,
      lastUsedAt: 9_000
    })
  })

  it('uses the upload time for a media without a capture date', () => {
    const usage = reduceGalleryGearUsage(
      [row('a', 'm1', { createdAt: 700 }), row('a', 'm2', { takenAt: 800 })],
      ['a']
    )

    expect(usage.get('a')).toMatchObject({
      firstUsedAt: 700,
      lastUsedAt: 800
    })
  })

  it('keeps gear apart and ignores rows for gear it was not asked about', () => {
    const usage = reduceGalleryGearUsage(
      [row('a', 'm1'), row('b', 'm1'), row('b', 'm2'), row('z', 'm9')],
      ['a', 'b']
    )

    expect(usage.get('a')?.photoCount).toBe(1)
    expect(usage.get('b')?.photoCount).toBe(2)
    expect(usage.has('z')).toBe(false)
  })

  it('ignores a date that is not a usable time', () => {
    const usage = reduceGalleryGearUsage(
      [row('a', 'm1', { takenAt: null, createdAt: 0 })],
      ['a']
    )

    expect(usage.get('a')).toEqual({
      photoCount: 1,
      firstUsedAt: null,
      lastUsedAt: null
    })
  })
})

describe('getMostUsedWith', () => {
  const rows = [
    row('cam', 'm1'),
    row('lensA', 'm1'),
    row('cam', 'm2'),
    row('lensA', 'm2'),
    row('cam', 'm3'),
    row('lensB', 'm3'),
    // Not with the camera.
    row('lensB', 'm4'),
    // Not in the gallery, so not counted.
    row('cam', 'm5', { inGallery: false }),
    row('lensC', 'm5', { inGallery: false })
  ]

  it('counts the gear shared with this one, most first', () => {
    expect(getMostUsedWith(rows, 'cam')).toEqual([
      { gearId: 'lensA', count: 2 },
      { gearId: 'lensB', count: 1 }
    ])
  })

  it('works from the lens side too', () => {
    expect(getMostUsedWith(rows, 'lensB')).toEqual([
      { gearId: 'cam', count: 1 }
    ])
  })

  it('breaks ties by id and honours the limit', () => {
    const tied = [row('x', 'm1'), row('b', 'm1'), row('a', 'm1')]
    expect(getMostUsedWith(tied, 'x')).toEqual([
      { gearId: 'a', count: 1 },
      { gearId: 'b', count: 1 }
    ])
    expect(getMostUsedWith(tied, 'x', 1)).toEqual([{ gearId: 'a', count: 1 }])
  })

  it('is empty for gear used alone', () => {
    expect(getMostUsedWith(rows, 'missing')).toEqual([])
  })
})

describe('getGalleryGearUsage', () => {
  it('reads the rows once and reduces them', async () => {
    const getGalleryGearUsageRows = vi
      .fn()
      .mockResolvedValue([row('a', 'm1', { takenAt: 4_000 })])

    const usage = await getGalleryGearUsage({
      database: { getGalleryGearUsageRows },
      actorId: 'actor-1',
      gearIds: ['a', 'b']
    })

    expect(getGalleryGearUsageRows).toHaveBeenCalledOnce()
    expect(getGalleryGearUsageRows).toHaveBeenCalledWith({
      actorId: 'actor-1',
      gearIds: ['a', 'b']
    })
    expect(usage.get('a')).toEqual({
      photoCount: 1,
      firstUsedAt: 4_000,
      lastUsedAt: 4_000
    })
    expect(usage.get('b')?.photoCount).toBe(0)
  })
})

describe('getGalleryGearOverview', () => {
  const gear = (id: string, name: string) => ({
    id,
    actorId: 'actor-1',
    kind: 'camera' as const,
    name,
    createdAt: 1,
    updatedAt: 1
  })

  it('reduces one gear and names the gear it is used with', async () => {
    const getGalleryGearUsageRows = vi
      .fn()
      .mockResolvedValue([
        row('cam', 'm1', { takenAt: 3_000 }),
        row('lens', 'm1', { takenAt: 3_000 }),
        row('cam', 'm2', { takenAt: 1_000 }),
        row('lens', 'm2', { takenAt: 1_000 })
      ])
    const getGalleryGearsByActor = vi
      .fn()
      .mockResolvedValue([gear('cam', 'Body'), gear('lens', '70-200')])

    const overview = await getGalleryGearOverview({
      database: { getGalleryGearUsageRows, getGalleryGearsByActor },
      actorId: 'actor-1',
      gearId: 'cam'
    })

    expect(getGalleryGearUsageRows).toHaveBeenCalledWith({
      actorId: 'actor-1',
      gearIds: ['cam', 'lens']
    })
    expect(overview.usage).toEqual({
      photoCount: 2,
      firstUsedAt: 1_000,
      lastUsedAt: 3_000
    })
    expect(overview.mostUsedWith).toEqual([
      expect.objectContaining({
        gear: expect.objectContaining({ id: 'lens', name: '70-200' }),
        count: 2
      })
    ])
  })

  it('drops a pairing whose gear is no longer there', async () => {
    const overview = await getGalleryGearOverview({
      database: {
        getGalleryGearUsageRows: vi
          .fn()
          .mockResolvedValue([row('cam', 'm1'), row('deleted', 'm1')]),
        getGalleryGearsByActor: vi.fn().mockResolvedValue([gear('cam', 'Body')])
      },
      actorId: 'actor-1',
      gearId: 'cam'
    })

    expect(overview.mostUsedWith).toEqual([])
    expect(overview.usage.photoCount).toBe(1)
  })
})
