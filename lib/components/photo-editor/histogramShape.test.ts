import { CLIP_OFF_COLOUR } from './histogramPalette'
import {
  CLIP_THRESHOLD,
  HISTOGRAM_HEIGHT,
  HISTOGRAM_WIDTH,
  buildAreaPath,
  buildLinePath,
  clipColour,
  clippedChannels,
  innerPeak,
  smoothBins,
  sqrtScale
} from './histogramShape'

describe('smoothBins', () => {
  it('applies [1,2,1] to inner bins and leaves the ends raw', () => {
    expect(smoothBins([100, 0, 4, 0, 100])).toEqual([100, 26, 2, 26, 100])
  })

  it('keeps flat series flat', () => {
    expect(smoothBins([5, 5, 5, 5])).toEqual([5, 5, 5, 5])
  })

  it('handles tiny inputs', () => {
    expect(smoothBins([])).toEqual([])
    expect(smoothBins([3])).toEqual([3])
    expect(smoothBins([3, 4])).toEqual([3, 4])
  })
})

describe('innerPeak', () => {
  it('ignores the end bins of every series', () => {
    expect(
      innerPeak([
        [999, 2, 7, 999],
        [999, 9, 1, 999]
      ])
    ).toBe(9)
  })

  it('is at least 1', () => {
    expect(innerPeak([[5, 0, 0, 5]])).toBe(1)
  })
})

describe('sqrtScale', () => {
  it.each([
    { description: 'zero', value: 0, peak: 100, expected: 0 },
    { description: 'quarter of the peak', value: 25, peak: 100, expected: 0.5 },
    { description: 'the peak', value: 100, peak: 100, expected: 1 },
    { description: 'above the peak', value: 400, peak: 100, expected: 1 },
    { description: 'negative', value: -4, peak: 100, expected: 0 }
  ])('scales $description', ({ value, peak, expected }) => {
    expect(sqrtScale(value, peak)).toBeCloseTo(expected)
  })
})

describe('paths', () => {
  it('anchors the area at the bottom corners and passes through bin centres', () => {
    const path = buildAreaPath([0, 4, 0, 4], 4)
    expect(path.startsWith(`M0 ${HISTOGRAM_HEIGHT} L`)).toBe(true)
    expect(path.endsWith(`L${HISTOGRAM_WIDTH} ${HISTOGRAM_HEIGHT} Z`)).toBe(
      true
    )
    expect(path).toContain('L224.0 2.0')
    expect(path).toContain('L96.0 2.0')
  })

  it('draws the line only through the bin centres', () => {
    expect(buildLinePath([0, 4], 4)).toBe(
      `M64.0 ${HISTOGRAM_HEIGHT.toFixed(1)} L192.0 2.0`
    )
  })
})

describe('clippedChannels', () => {
  it('turns on only channels above the threshold', () => {
    const total = 10000
    const over = total * CLIP_THRESHOLD + 1
    expect(
      clippedChannels({ r: over, g: total * CLIP_THRESHOLD, b: 0 }, total)
    ).toEqual({ r: true, g: false, b: false })
  })

  it('is off for an empty image', () => {
    expect(clippedChannels({ r: 0, g: 0, b: 0 }, 0)).toEqual({
      r: false,
      g: false,
      b: false
    })
  })
})

describe('clipColour', () => {
  it.each([
    {
      description: 'no channel',
      channels: { r: false, g: false, b: false },
      expected: CLIP_OFF_COLOUR
    },
    {
      description: 'red only',
      channels: { r: true, g: false, b: false },
      expected: 'rgb(240, 32, 32)'
    },
    {
      description: 'red and green',
      channels: { r: true, g: true, b: false },
      expected: 'rgb(240, 240, 32)'
    },
    {
      description: 'green and blue',
      channels: { r: false, g: true, b: true },
      expected: 'rgb(32, 240, 240)'
    },
    {
      description: 'all channels',
      channels: { r: true, g: true, b: true },
      expected: 'rgb(240, 240, 240)'
    }
  ])('colours $description', ({ channels, expected }) => {
    expect(clipColour(channels)).toBe(expected)
  })
})
