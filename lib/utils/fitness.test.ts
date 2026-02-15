import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation,
  getFitnessPaceOrSpeed
} from '@/lib/utils/fitness'

describe('#fitness utils', () => {
  describe('#formatFitnessDistance', () => {
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

  describe('#formatFitnessDuration', () => {
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

  describe('#formatFitnessElevation', () => {
    it('formats elevation gain', () => {
      expect(formatFitnessElevation(132.4)).toBe('132 m')
    })

    it('returns fallback for invalid values', () => {
      expect(formatFitnessElevation(undefined, { fallback: '0 m' })).toBe('0 m')
      expect(formatFitnessElevation(0)).toBeNull()
    })
  })

  describe('#getFitnessPaceOrSpeed', () => {
    it('returns pace for running activities', () => {
      expect(
        getFitnessPaceOrSpeed({
          distanceMeters: 5_000,
          durationSeconds: 1_499,
          activityType: 'running'
        })
      ).toEqual({ label: 'Pace', value: '5:00 / km' })
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

    it('returns null when required values are missing', () => {
      expect(getFitnessPaceOrSpeed({ durationSeconds: 300 })).toBeNull()
    })
  })
})
