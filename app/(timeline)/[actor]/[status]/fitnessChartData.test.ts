import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TICK_COUNT,
  HEART_RATE_ZONES,
  buildGappedChartPaths,
  buildXAxisLabels,
  clampNumber,
  computeHeartRateStats,
  computeHeartRateZones,
  computePowerHistogramMinutes,
  downsampleSeries,
  fillHeartRateDropouts,
  filterPositiveHeartRateSeries,
  formatChartValue,
  formatDuration,
  getChartXPosition,
  getChartYPosition,
  getSeriesMinMax
} from './fitnessChartData'

describe('fitnessChartData', () => {
  describe('clampNumber', () => {
    it('clamps values below min or above max', () => {
      expect(clampNumber(-5, 0, 10)).toBe(0)
      expect(clampNumber(15, 0, 10)).toBe(10)
      expect(clampNumber(7, 0, 10)).toBe(7)
    })
  })

  describe('downsampling', () => {
    it('handles empty and single-point series', () => {
      expect(downsampleSeries([], 10)).toEqual([])
      expect(downsampleSeries([42], 5)).toEqual([42])
      expect(downsampleSeries([42], 1)).toEqual([42])
      expect(downsampleSeries([1, 2, 3], 0)).toEqual([])
    })

    it('leaves series shorter than targetCount untouched', () => {
      const series = [10, 20, 30]
      expect(downsampleSeries(series, 5)).toBe(series)
    })

    it('averages chunks evenly when downsampling', () => {
      const series = [10, 20, 30, 40]
      expect(downsampleSeries(series, 2)).toEqual([15, 35])
    })
  })

  describe('getSeriesMinMax', () => {
    it('handles empty and single-point series', () => {
      expect(getSeriesMinMax([])).toEqual({ minValue: 0, maxValue: 0 })
      expect(getSeriesMinMax([42])).toEqual({ minValue: 42, maxValue: 42 })
    })

    it('handles flat ranges', () => {
      expect(getSeriesMinMax([50, 50, 50, 50])).toEqual({
        minValue: 50,
        maxValue: 50
      })
    })

    it('computes min and max on large datasets safely without stack overflow', () => {
      const count = 50_000
      const large = Array.from({ length: count }, (_, i) => i - 25_000)
      const { minValue, maxValue } = getSeriesMinMax(large)
      expect(minValue).toBe(-25_000)
      expect(maxValue).toBe(24_999)
    })
  })

  describe('formatChartValue (negative-zero formatting)', () => {
    it('formats numbers and suppresses negative zero', () => {
      expect(formatChartValue(-0.3, 0)).toBe('0')
      expect(formatChartValue(-0.0001, 2)).toBe('0.00')
      expect(formatChartValue(-0, 0)).toBe('0')
      expect(formatChartValue(-0, 1)).toBe('0.0')
      expect(formatChartValue(0, 0)).toBe('0')
    })

    it('formats positive and negative non-zero values accurately', () => {
      expect(formatChartValue(15.42, 1)).toBe('15.4')
      expect(formatChartValue(15.46, 1)).toBe('15.5')
      expect(formatChartValue(-12.4, 0)).toBe('-12')
      expect(formatChartValue(1234.567, 2)).toBe('1234.57')
    })
  })

  describe('formatDuration (boundary durations)', () => {
    it('handles boundary and edge durations', () => {
      expect(formatDuration(undefined)).toBe('0:00')
      expect(formatDuration(0)).toBe('0:00')
      expect(formatDuration(-10)).toBe('0:00')
      expect(formatDuration(59)).toBe('0:59')
      expect(formatDuration(60)).toBe('1:00')
      expect(formatDuration(3599)).toBe('59:59')
      expect(formatDuration(3600)).toBe('1:00:00')
      expect(formatDuration(3661)).toBe('1:01:01')
      expect(formatDuration(86400)).toBe('24:00:00')
    })
  })

  describe('buildXAxisLabels', () => {
    it('generates ticks for boundary tick counts', () => {
      expect(buildXAxisLabels(1800, 0)).toEqual([])
      expect(buildXAxisLabels(1800, 1)).toEqual(['0:00'])
      expect(buildXAxisLabels(0, 4)).toEqual(['0:00', '0:00', '0:00', '0:00'])
    })

    it('generates four ticks when asked for four', () => {
      expect(buildXAxisLabels(1800, 4)).toEqual([
        '0:00',
        '10:00',
        '20:00',
        '30:00'
      ])
    })

    it('generates six ticks for default analysis charts', () => {
      expect(buildXAxisLabels(1800, DEFAULT_TICK_COUNT)).toEqual([
        '0:00',
        '6:00',
        '12:00',
        '18:00',
        '24:00',
        '30:00'
      ])
    })
  })

  describe('heart rate calculations and dropout treatment', () => {
    it('computes heart rate training zones for empty and normal series', () => {
      expect(HEART_RATE_ZONES).toHaveLength(5)
      const emptyZones = computeHeartRateZones([], 1800)
      expect(emptyZones).toHaveLength(5)
      expect(emptyZones.every((z) => z.seconds === 0 && z.pct === 0)).toBe(true)

      // 100 bpm is Z1 (Recovery, lo: 0, hi: 122)
      // 130 bpm is Z2 (Endurance, lo: 122, hi: 142)
      const zones = computeHeartRateZones([100, 130], 1800)
      expect(zones[0].name).toBe('Z1')
      expect(zones[0].seconds).toBe(900)
      expect(zones[0].pct).toBe(50)
      expect(zones[1].name).toBe('Z2')
      expect(zones[1].seconds).toBe(900)
      expect(zones[1].pct).toBe(50)
    })

    it('excludes 0 bpm sensor dropouts from heart rate zones', () => {
      // 0 bpm readings must be ignored so they don't inflate Z1
      const zones = computeHeartRateZones([0, 130, 0, 130], 1800)
      expect(zones[0].seconds).toBe(0)
      expect(zones[0].pct).toBe(0)
      expect(zones[1].seconds).toBe(1800)
      expect(zones[1].pct).toBe(100)
    })

    it('filters positive heart rate series', () => {
      expect(filterPositiveHeartRateSeries([0, 120, -5, 140, 0])).toEqual([
        120, 140
      ])
    })

    it('treats heart-rate gaps and dropouts by holding last reading and backfilling leading dropouts', () => {
      expect(fillHeartRateDropouts([])).toEqual([])
      expect(fillHeartRateDropouts([0, 0, 0])).toEqual([])
      // Single reading
      expect(fillHeartRateDropouts([140])).toEqual([140])
      // Leading dropouts: back-fill with first positive reading
      expect(fillHeartRateDropouts([0, 0, 140, 150])).toEqual([
        140, 140, 140, 150
      ])
      // Middle dropouts: hold last reading across gap
      expect(fillHeartRateDropouts([130, 0, 0, 150])).toEqual([
        130, 130, 130, 150
      ])
      // Trailing dropouts: hold last reading across gap
      expect(fillHeartRateDropouts([130, 140, 0, 0])).toEqual([
        130, 140, 140, 140
      ])
    })

    it('computes heart rate stats ignoring dropouts', () => {
      expect(computeHeartRateStats([])).toBeNull()
      expect(computeHeartRateStats([0, 0])).toBeNull()
      expect(computeHeartRateStats([0, 150, 0, 150, 150])).toEqual({
        avg: 150,
        max: 150
      })
      expect(computeHeartRateStats([120, 140, 160])).toEqual({
        avg: 140,
        max: 160
      })
    })
  })

  describe('computePowerHistogramMinutes', () => {
    it('handles empty and small series', () => {
      expect(computePowerHistogramMinutes([])).toEqual([])
      // 50W falls in bucket 2 (50 / 25 = 2). 60 samples at 50W = 1 minute
      const series = new Array(60).fill(50)
      const histogram = computePowerHistogramMinutes(series)
      expect(histogram[2]).toBe(1)
    })

    it('computes power histogram on large datasets safely without stack overflow', () => {
      const large = new Array(50_000).fill(200)
      const histogram = computePowerHistogramMinutes(large)
      expect(histogram.length).toBeGreaterThan(0)
      expect(histogram[8]).toBe(50_000 / 60)
    })
  })

  describe('coordinate projection', () => {
    it('projects X position across count and width', () => {
      expect(getChartXPosition(0, 1, 800)).toBe(0)
      expect(getChartXPosition(0, 5, 800)).toBe(0)
      expect(getChartXPosition(2, 5, 800)).toBe(400)
      expect(getChartXPosition(4, 5, 800)).toBe(800)
    })

    it('projects Y position safely on flat ranges', () => {
      // Range is max(1, 50 - 50) = 1, so y = height - (0/1)*height = height
      expect(getChartYPosition(50, 200, 50, 50)).toBe(200)
      expect(getChartYPosition(100, 200, 0, 100)).toBe(0)
      expect(getChartYPosition(0, 200, 0, 100)).toBe(200)
      expect(getChartYPosition(50, 200, 0, 100)).toBe(100)
    })
  })

  describe('buildGappedChartPaths', () => {
    it('draws one subpath per unbroken run, each closed to the bottom', () => {
      const { line, area } = buildGappedChartPaths(
        [0, 10, null, 10, 0],
        0,
        10,
        100,
        50
      )
      expect(line).toBe('M0.0 50.0L25.0 0.0M75.0 0.0L100.0 50.0')
      expect(area).toBe(
        'M0.0 50.0L25.0 0.0L25.0 50L0.0 50ZM75.0 0.0L100.0 50.0L100.0 50L75.0 50Z'
      )
    })

    it('draws nothing for an empty or all-missing series', () => {
      expect(buildGappedChartPaths([], 0, 1, 100, 50)).toEqual({
        line: '',
        area: ''
      })
      expect(buildGappedChartPaths([null, null], 0, 1, 100, 50)).toEqual({
        line: '',
        area: ''
      })
    })

    it('draws a flat series without dividing by zero', () => {
      const { line } = buildGappedChartPaths([5, 5], 5, 5, 100, 50)
      expect(line).not.toContain('NaN')
    })
  })
})
