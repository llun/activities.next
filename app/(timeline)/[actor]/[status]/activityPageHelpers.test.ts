import type { Attachment } from '@/lib/types/domain/attachment'

import { formatEffortDuration } from './ActivityBestEfforts'
import { getVisibleOverviewGroups } from './ActivityOverviewSection'
import { getRouteMapAttachmentIndex } from './ActivityPostFrame'
import { getSplitColumns } from './ActivitySplitsTables'
import { isGraphShownByDefault } from './FitnessStatusDetail'
import type { ActivitySplit } from './fitnessActivityMetrics'

const split = (overrides: Partial<ActivitySplit> = {}): ActivitySplit => ({
  key: 'lap-0',
  label: 'Lap 1',
  subline: null,
  startSeconds: 0,
  endSeconds: 600,
  durationSeconds: 600,
  distanceMeters: null,
  avgSpeedKmh: null,
  avgPower: null,
  avgHeartRate: null,
  avgCadence: null,
  gainMeters: null,
  gradePercent: null,
  ...overrides
})

const attachment = (name: string) => ({ name }) as Attachment

describe('getVisibleOverviewGroups', () => {
  it('drops rows the file has no value for, then groups left empty', () => {
    const groups = getVisibleOverviewGroups([
      {
        key: 'ride',
        title: 'Ride',
        colour: 'speed',
        rows: [
          { label: 'Elapsed time', value: '1:00:00' },
          { label: 'Calories', value: null }
        ]
      },
      {
        key: 'power',
        title: 'Power',
        colour: 'power',
        rows: [{ label: 'Weighted', value: null }]
      }
    ])

    expect(groups).toEqual([
      {
        key: 'ride',
        title: 'Ride',
        colour: 'speed',
        rows: [{ label: 'Elapsed time', value: '1:00:00' }]
      }
    ])
  })

  it('keeps a zero reading, which is data', () => {
    const groups = getVisibleOverviewGroups([
      {
        key: 'weather',
        title: 'Cadence and weather',
        colour: 'cadence',
        rows: [{ label: 'Time at 0 W', value: '0:00' }]
      }
    ])

    expect(groups[0].rows).toHaveLength(1)
  })
})

describe('getSplitColumns', () => {
  it('shares, in a fixed order, every column either table can fill', () => {
    const laps = [split({ distanceMeters: 5000, avgPower: 180 })]
    const climbs = [
      split({ gainMeters: 40, gradePercent: 4, avgHeartRate: 150 })
    ]

    expect(getSplitColumns(laps, climbs)).toEqual([
      'time',
      'distance',
      'power',
      'heartRate',
      'gain',
      'grade'
    ])
  })

  it('leaves out a column no row of either table has', () => {
    expect(getSplitColumns([split()], [])).toEqual(['time'])
    expect(getSplitColumns([], [])).toEqual([])
  })
})

describe('formatEffortDuration', () => {
  it.each([
    [5, '5 s'],
    [60, '1 min'],
    [1200, '20 min'],
    [3600, '1 h'],
    [5400, '1.5 h']
  ])('formats %d seconds as %s', (seconds, label) => {
    expect(formatEffortDuration(seconds)).toBe(label)
  })
})

describe('getRouteMapAttachmentIndex', () => {
  it('finds the attachment named as the route map, wherever it is', () => {
    expect(
      getRouteMapAttachmentIndex(
        [attachment('Summit'), attachment('Activity route map')],
        false
      )
    ).toBe(1)
  })

  it('takes the first attachment of a file with map data, else none', () => {
    const photos = [attachment('map.webp'), attachment('Summit')]
    expect(getRouteMapAttachmentIndex(photos, true)).toBe(0)
    expect(getRouteMapAttachmentIndex(photos, false)).toBe(-1)
    expect(getRouteMapAttachmentIndex([], true)).toBe(-1)
  })
})

describe('isGraphShownByDefault', () => {
  it('starts with speed and grade off when the file has power', () => {
    expect(isGraphShownByDefault('power', true)).toBe(true)
    expect(isGraphShownByDefault('elevation', true)).toBe(true)
    expect(isGraphShownByDefault('speed', true)).toBe(false)
    expect(isGraphShownByDefault('grade', true)).toBe(false)
  })

  it('shows speed, with only grade off, when it has none', () => {
    expect(isGraphShownByDefault('speed', false)).toBe(true)
    expect(isGraphShownByDefault('grade', false)).toBe(false)
  })
})
