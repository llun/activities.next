import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_SAMPLES_PER_POINT,
  ANALYSIS_SERIES_MAX_POINTS,
  ANALYSIS_SERIES_MIN_POINTS,
  CHART_READOUT_FLIP_THRESHOLD,
  DEFAULT_TICK_COUNT,
  GRAPH_VIEW_HEIGHT,
  HEART_RATE_ZONES,
  OVERVIEW_GRAPH_VIEW_HEIGHT,
  OVERVIEW_TICK_COUNT,
  buildChartAreaPath,
  buildChartPath,
  buildXAxisLabels,
  clampNumber,
  computeChartHighlight,
  computeCombinedChartHighlights,
  computeHeartRateStats,
  computeHeartRateZones,
  computeHighlightedIndex,
  computePowerHistogramMinutes,
  downsampleSeries,
  fillHeartRateDropouts,
  filterPositiveHeartRateSeries,
  formatChartValue,
  formatDuration,
  getChartXPosition,
  getChartYPosition,
  getSeriesMinMax,
  plotAtStravaDensity,
  scaleCombinedChartSeries,
  shouldFlipChartReadout
} from './fitnessChartData'

describe('fitnessChartData', () => {
  describe('constants', () => {
    it('defines standard density and sample limits matching Strava', () => {
      expect(ANALYSIS_SAMPLES_PER_POINT).toBe(8)
      expect(ANALYSIS_SERIES_MIN_POINTS).toBe(120)
      expect(ANALYSIS_SERIES_MAX_POINTS).toBe(1200)
      expect(DEFAULT_TICK_COUNT).toBe(6)
      expect(OVERVIEW_TICK_COUNT).toBe(4)
      expect(GRAPH_VIEW_HEIGHT).toBe(250)
      expect(OVERVIEW_GRAPH_VIEW_HEIGHT).toBe(130)
      expect(CHART_READOUT_FLIP_THRESHOLD).toBe(0.62)
    })
  })

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

    it('plots at Strava density for empty and single-point series', () => {
      expect(plotAtStravaDensity([])).toEqual([])
      expect(plotAtStravaDensity([100])).toEqual([100])
    })

    it('plots at Strava density with 8:1 ratio', () => {
      // 1000 samples / 8 = 125 points
      const ramp = Array.from({ length: 1000 }, (_, i) => i)
      const plotted = plotAtStravaDensity(ramp)
      expect(plotted).toHaveLength(125)
    })

    it('enforces floor of 120 points on short recordings', () => {
      // 600 samples / 8 = 75 points -> floored to 120
      const ramp = Array.from({ length: 600 }, (_, i) => i)
      const plotted = plotAtStravaDensity(ramp)
      expect(plotted).toHaveLength(120)
    })

    it('enforces ceiling of 1200 points on very long recordings (large datasets)', () => {
      // 40,000 samples / 8 = 5,000 -> capped at 1200
      const ramp = Array.from({ length: 40_000 }, (_, i) => i)
      const plotted = plotAtStravaDensity(ramp)
      expect(plotted).toHaveLength(1200)
    })

    it('leaves series shorter than the 120-point floor at its own resolution', () => {
      const short = [10, 20, 30, 40, 50]
      expect(plotAtStravaDensity(short)).toHaveLength(5)
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

  describe('buildChartPath and buildChartAreaPath', () => {
    it('handles empty series', () => {
      expect(buildChartPath([], 800, 200)).toBe('')
      expect(buildChartAreaPath('', 800, 200)).toBe('')
    })

    it('handles single-point series', () => {
      const path = buildChartPath([50], 800, 200)
      expect(path).toBe('M 0.00 200.00')
      const area = buildChartAreaPath(path, 800, 200)
      expect(area).toBe('M 0.00 200.00 L 800.00 200 L 0 200 Z')
    })

    it('handles flat ranges without NaN or Infinity', () => {
      const path = buildChartPath([50, 50, 50], 800, 200)
      expect(path).toBe('M 0.00 200.00 L 400.00 200.00 L 800.00 200.00')
      const area = buildChartAreaPath(path, 800, 200)
      expect(area).toBe(
        'M 0.00 200.00 L 400.00 200.00 L 800.00 200.00 L 800.00 200 L 0 200 Z'
      )
    })

    it('builds valid SVG path for varying series with custom min/max', () => {
      const path = buildChartPath([0, 50, 100], 800, 200, 0, 100)
      expect(path).toBe('M 0.00 200.00 L 400.00 100.00 L 800.00 0.00')
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

    it('generates four ticks for overview cards', () => {
      expect(buildXAxisLabels(1800, OVERVIEW_TICK_COUNT)).toEqual([
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

  describe('combined-chart scaling', () => {
    it('scales each series independently to its own range', () => {
      const elevation = { key: 'elevation', values: [0, 25, 50] }
      const heartRate = { key: 'heart-rate', values: [100, 150, 200] }
      const width = 800
      const height = 200

      const [scaledElevation, scaledHeartRate] = scaleCombinedChartSeries(
        [elevation, heartRate],
        width,
        height
      )

      expect(scaledElevation.minValue).toBe(0)
      expect(scaledElevation.maxValue).toBe(50)
      // Both highest values map to SVG y = 0
      expect(scaledElevation.path).toBe(
        'M 0.00 200.00 L 400.00 100.00 L 800.00 0.00'
      )

      expect(scaledHeartRate.minValue).toBe(100)
      expect(scaledHeartRate.maxValue).toBe(200)
      expect(scaledHeartRate.path).toBe(
        'M 0.00 200.00 L 400.00 100.00 L 800.00 0.00'
      )
    })

    it('computes combined chart highlights at given ratio', () => {
      const width = 800
      const height = 200
      const plotted = [
        {
          key: 'elevation' as const,
          label: 'Elevation',
          unit: 'm',
          fractionDigits: 0,
          values: [10, 20, 30],
          minValue: 10,
          maxValue: 30,
          path: ''
        },
        {
          key: 'speed' as const,
          label: 'Speed',
          unit: 'km/h',
          fractionDigits: 1,
          values: [20, 25, 30],
          minValue: 20,
          maxValue: 30,
          path: ''
        }
      ]

      expect(
        computeCombinedChartHighlights(plotted, null, width, height)
      ).toEqual([])

      const highlights = computeCombinedChartHighlights(
        plotted,
        0.5,
        width,
        height
      )
      expect(highlights).toEqual([
        {
          key: 'elevation',
          unit: 'm',
          fractionDigits: 0,
          value: 20,
          x: 400,
          y: 100
        },
        {
          key: 'speed',
          unit: 'km/h',
          fractionDigits: 1,
          value: 25,
          x: 400,
          y: 100
        }
      ])
    })
  })

  describe('scrub highlight helpers', () => {
    it('computes highlighted index from elapsed time and duration', () => {
      expect(computeHighlightedIndex(null, 1800, 100)).toBeNull()
      expect(computeHighlightedIndex(0, 1800, 100)).toBe(0)
      expect(computeHighlightedIndex(900, 1800, 100)).toBe(50)
      expect(computeHighlightedIndex(1800, 1800, 100)).toBe(99)
      expect(computeHighlightedIndex(-50, 1800, 100)).toBe(0)
      expect(computeHighlightedIndex(2500, 1800, 100)).toBe(99)
      expect(computeHighlightedIndex(100, 0, 100)).toBeNull()
    })

    it('computes single chart highlight', () => {
      const values = [10, 20, 30]
      expect(computeChartHighlight(values, null, 800, 200, 10, 30)).toBeNull()
      expect(computeChartHighlight(values, 1, 800, 200, 10, 30)).toEqual({
        value: 20,
        x: 400,
        y: 100
      })
    })

    it('determines when hover readout should flip', () => {
      expect(shouldFlipChartReadout(400, 800)).toBe(false)
      expect(shouldFlipChartReadout(500, 800)).toBe(true) // 500 / 800 = 0.625 > 0.62
      expect(shouldFlipChartReadout(100, 0)).toBe(false)
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
})
