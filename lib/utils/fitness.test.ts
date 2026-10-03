import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation,
  formatFitnessPace,
  getFitnessPaceOrSpeed,
  getFitnessSourceLabel,
  normalizeFitnessSourceUrl
} from '@/lib/utils/fitness'

describe('fitness utils', () => {
  describe('getFitnessSourceLabel', () => {
    it('labels Strava-hosted URLs as "View on Strava"', () => {
      expect(
        getFitnessSourceLabel('https://www.strava.com/activities/123')
      ).toBe('View on Strava')
      expect(getFitnessSourceLabel('https://strava.com/activities/123')).toBe(
        'View on Strava'
      )
    })

    it('falls back to "View source" for other or missing URLs', () => {
      expect(getFitnessSourceLabel('https://example.com/activity/1')).toBe(
        'View source'
      )
      expect(getFitnessSourceLabel('not a url')).toBe('View source')
      expect(getFitnessSourceLabel(undefined)).toBe('View source')
      expect(getFitnessSourceLabel(null)).toBe('View source')
    })
  })

  describe('normalizeFitnessSourceUrl', () => {
    it('returns http(s) URLs unchanged', () => {
      expect(
        normalizeFitnessSourceUrl('https://www.strava.com/activities/123')
      ).toBe('https://www.strava.com/activities/123')
      expect(normalizeFitnessSourceUrl('http://example.com/a')).toBe(
        'http://example.com/a'
      )
    })

    it('rejects non-http schemes and invalid/empty values', () => {
      expect(normalizeFitnessSourceUrl('javascript:alert(1)')).toBeNull()
      expect(normalizeFitnessSourceUrl('data:text/html,x')).toBeNull()
      expect(normalizeFitnessSourceUrl('not a url')).toBeNull()
      expect(normalizeFitnessSourceUrl('')).toBeNull()
      expect(normalizeFitnessSourceUrl(undefined)).toBeNull()
      expect(normalizeFitnessSourceUrl(null)).toBeNull()
    })
  })

  describe('formatFitnessDistance', () => {
    it('formats short and long distances', () => {
      expect(formatFitnessDistance(5_234)).toBe('5.23 km')
      expect(formatFitnessDistance(12_450)).toBe('12.4 km')
    })

    it('returns fallback for invalid values', () => {
      expect(formatFitnessDistance(undefined, { fallback: '0.00 km' })).toBe(
        '0.00 km'
      )
      expect(formatFitnessDistance(0)).toBeNull()
    })
  })

  describe('formatFitnessDuration', () => {
    it('formats minute and hour durations', () => {
      expect(formatFitnessDuration(95)).toBe('1:35')
      expect(formatFitnessDuration(3_661)).toBe('1:01:01')
    })

    it('returns fallback for invalid values', () => {
      expect(formatFitnessDuration(undefined, { fallback: '0:00' })).toBe(
        '0:00'
      )
      expect(formatFitnessDuration(0)).toBeNull()
    })
  })

  describe('formatFitnessElevation', () => {
    it('formats elevation gain', () => {
      expect(formatFitnessElevation(132.4)).toBe('132 m')
    })

    it('returns fallback for invalid values', () => {
      expect(formatFitnessElevation(undefined, { fallback: '0 m' })).toBe('0 m')
      expect(formatFitnessElevation(0)).toBeNull()
    })
  })

  describe('formatFitnessPace', () => {
    it('formats seconds per kilometre as m:ss /km with no space after the slash', () => {
      expect(formatFitnessPace(309)).toBe('5:09 /km')
      expect(formatFitnessPace(300)).toBe('5:00 /km')
      expect(formatFitnessPace(65)).toBe('1:05 /km')
    })

    it('rounds the total seconds before splitting, so :59.5 carries into the minute', () => {
      expect(formatFitnessPace(359.4)).toBe('5:59 /km')
      expect(formatFitnessPace(359.5)).toBe('6:00 /km')
      expect(formatFitnessPace(308.5)).toBe('5:09 /km')
    })

    it('keeps counting minutes past an hour per kilometre', () => {
      expect(formatFitnessPace(3_725)).toBe('62:05 /km')
    })

    it('returns null for a missing, zero, negative or non-finite pace', () => {
      expect(formatFitnessPace(undefined)).toBeNull()
      expect(formatFitnessPace(0)).toBeNull()
      expect(formatFitnessPace(0.4)).toBeNull()
      expect(formatFitnessPace(-30)).toBeNull()
      expect(formatFitnessPace(Number.NaN)).toBeNull()
      expect(formatFitnessPace(Number.POSITIVE_INFINITY)).toBeNull()
    })

    it('returns the fallback for an unusable pace', () => {
      expect(formatFitnessPace(undefined, { fallback: '-' })).toBe('-')
      expect(formatFitnessPace(0, { fallback: '-' })).toBe('-')
      expect(formatFitnessPace(309, { fallback: '-' })).toBe('5:09 /km')
    })
  })

  describe('getFitnessPaceOrSpeed', () => {
    it('writes the pace the way the design system does', () => {
      // The activity-import email board: 8.21 km in 42:18 reads "5:09 /km".
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 8_210,
          durationSeconds: 2_538,
          activityType: 'running'
        })
      ).toEqual({ label: 'Pace', value: '5:09 /km' })
    })

    it('carries a :59.5 pace into the next minute instead of printing :60', () => {
      // 1 km in 359.5 s: Math.round puts it at 360 s, i.e. 6:00.
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 1_000,
          durationSeconds: 359.5,
          activityType: 'running'
        })
      ).toEqual({ label: 'Pace', value: '6:00 /km' })
    })

    it('returns pace for running activities', () => {
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 5_000,
          durationSeconds: 1_499,
          activityType: 'running'
        })
      ).toEqual({ label: 'Pace', value: '5:00 /km' })
    })

    it('returns speed for cycling activities', () => {
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 20_000,
          durationSeconds: 3_600,
          activityType: 'cycling'
        })
      ).toEqual({
        label: 'Avg speed',
        value: '20.0 km/h',
        speedKmh: 20
      })
    })

    it('computes average speed from moving time when provided', () => {
      // 20 km covered while moving for 48 minutes (2880s), even though the
      // activity spanned 60 minutes of elapsed time (3600s). Strava reports the
      // moving-time speed (25 km/h), not the elapsed-time speed (20 km/h).
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 20_000,
          durationSeconds: 3_600,
          movingTimeSeconds: 2_880,
          activityType: 'cycling'
        })
      ).toEqual({
        label: 'Avg speed',
        value: '25.0 km/h',
        speedKmh: 25
      })
    })

    it('computes running pace from moving time when provided', () => {
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 5_000,
          durationSeconds: 1_800,
          movingTimeSeconds: 1_499,
          activityType: 'running'
        })
      ).toEqual({ label: 'Pace', value: '5:00 /km' })
    })

    it('falls back to elapsed duration when moving time is absent or invalid', () => {
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 20_000,
          durationSeconds: 3_600,
          movingTimeSeconds: 0,
          activityType: 'cycling'
        })
      ).toEqual({
        label: 'Avg speed',
        value: '20.0 km/h',
        speedKmh: 20
      })
    })

    it('returns null when required values are missing', () => {
      expect(getFitnessPaceOrSpeed({ durationSeconds: 300 })).toBeNull()
    })
  })
})
