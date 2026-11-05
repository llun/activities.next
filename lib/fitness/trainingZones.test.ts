import {
  DEFAULT_HEART_RATE_ZONES,
  ZONE_COLORS,
  formatZoneRange,
  getHeartRateZones,
  getPowerZones
} from '@/lib/fitness/trainingZones'

const lowerBounds = (zones: { lo: number }[] | null) =>
  zones?.map((zone) => zone.lo)

describe('trainingZones', () => {
  it('keeps the fixed default heart-rate zones', () => {
    expect(
      DEFAULT_HEART_RATE_ZONES.map(({ name, label, lo, hi }) => [
        name,
        label,
        lo,
        hi
      ])
    ).toEqual([
      ['Z1', 'Recovery', 0, 122],
      ['Z2', 'Endurance', 122, 142],
      ['Z3', 'Tempo', 142, 158],
      ['Z4', 'Threshold', 158, 172],
      ['Z5', 'Anaerobic', 172, null]
    ])
  })

  it('has no personal zones without inputs', () => {
    expect(getHeartRateZones(null)).toBeNull()
    expect(getHeartRateZones({ restingHeartRate: 50 })).toBeNull()
    expect(getPowerZones({ maxHeartRate: 186 })).toBeNull()
  })

  it('works heart-rate zones out from max heart rate', () => {
    const zones = getHeartRateZones({ maxHeartRate: 186 })
    expect(lowerBounds(zones)).toEqual([0, 123, 141, 158, 171])
    expect(zones?.map((zone) => zone.hi)).toEqual([123, 141, 158, 171, null])
    expect(zones?.map((zone) => zone.label)).toEqual([
      'Recovery',
      'Endurance',
      'Tempo',
      'Threshold',
      'Anaerobic'
    ])
    expect(zones?.map((zone) => zone.color)).toEqual(
      DEFAULT_HEART_RATE_ZONES.map((zone) => zone.color)
    )
  })

  it('uses the heart-rate reserve with a resting heart rate', () => {
    // 50 + share × 136
    expect(
      lowerBounds(
        getHeartRateZones({ maxHeartRate: 186, restingHeartRate: 50 })
      )
    ).toEqual([0, 132, 145, 159, 172])
  })

  it('ignores a resting heart rate that is not below max', () => {
    expect(
      lowerBounds(
        getHeartRateZones({ maxHeartRate: 120, restingHeartRate: 120 })
      )
    ).toEqual(lowerBounds(getHeartRateZones({ maxHeartRate: 120 })))
  })

  it('works six power zones out from FTP', () => {
    const zones = getPowerZones({ functionalThresholdPower: 260 })
    expect(lowerBounds(zones)).toEqual([0, 143, 195, 234, 273, 312])
    expect(zones?.map((zone) => zone.label)).toEqual([
      'Active recovery',
      'Endurance',
      'Tempo',
      'Threshold',
      'VO2 max',
      'Anaerobic'
    ])
    expect(zones?.map((zone) => zone.color)).toEqual([
      ...ZONE_COLORS,
      ZONE_COLORS[ZONE_COLORS.length - 1]
    ])
  })

  it('formats a zone range', () => {
    const [first, second, , , , last] = getPowerZones({
      functionalThresholdPower: 260
    })!
    expect(formatZoneRange(first, 'W')).toBe('< 143 W')
    expect(formatZoneRange(second, 'W')).toBe('143–195 W')
    expect(formatZoneRange(last, 'W')).toBe('312+ W')
  })
})
