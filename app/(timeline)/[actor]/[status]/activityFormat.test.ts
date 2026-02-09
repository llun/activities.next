import {
  formatActivityDistance,
  formatActivityDuration,
  formatActivityElevation,
  formatActivityPace,
  formatActivitySpeed,
  getEffortMetric,
  isPaceActivity
} from './activityFormat'

describe('activityFormat', () => {
  describe('formatActivityDistance', () => {
    it('formats meters under one kilometer', () => {
      expect(formatActivityDistance(532)).toBe('532 m')
    })

    it('formats kilometers for larger distances', () => {
      expect(formatActivityDistance(10540)).toBe('10.54 km')
    })

    it('returns placeholder for missing distance', () => {
      expect(formatActivityDistance(null)).toBe('--')
    })
  })

  describe('formatActivityDuration', () => {
    it('formats short durations as m:ss', () => {
      expect(formatActivityDuration(359)).toBe('5:59')
    })

    it('formats long durations as h:mm:ss', () => {
      expect(formatActivityDuration(3661)).toBe('1:01:01')
    })

    it('returns placeholder for missing duration', () => {
      expect(formatActivityDuration(undefined)).toBe('--')
    })
  })

  describe('pace and speed formatting', () => {
    it('formats pace as min/km', () => {
      expect(formatActivityPace(1000 / 300)).toBe('5:00/km')
    })

    it('handles pace rounding without producing xx:60', () => {
      expect(formatActivityPace(1000 / 299.6)).toBe('5:00/km')
    })

    it('formats speed as km/h', () => {
      expect(formatActivitySpeed(10)).toBe('36.0 km/h')
    })

    it('formats elevation gain', () => {
      expect(formatActivityElevation(487.4)).toBe('487 m')
    })
  })

  describe('getEffortMetric', () => {
    it('uses pace for pace-based activities', () => {
      expect(isPaceActivity('Run')).toBe(true)
      expect(getEffortMetric('Run', 1000 / 300)).toEqual({
        label: 'Pace',
        value: '5:00/km'
      })
    })

    it('uses speed for non-pace activities', () => {
      expect(isPaceActivity('Ride')).toBe(false)
      expect(getEffortMetric('Ride', 8)).toEqual({
        label: 'Avg speed',
        value: '28.8 km/h'
      })
    })
  })
})
