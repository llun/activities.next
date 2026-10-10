import { clampCropToImage } from '@/lib/services/medias/edit/geometry'

import {
  getAspectRatio,
  getHandlePoints,
  moveCrop,
  resizeCrop
} from './cropMath'

const oriented = { width: 1000, height: 500 }
const full = { x: 0, y: 0, width: 1, height: 1 }
const centred = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

describe('getAspectRatio', () => {
  it.each([
    ['free', false, null],
    ['original', false, 2],
    ['1:1', false, 1],
    ['4:5', false, 0.8],
    ['4:5', true, 1.25],
    ['16:9', false, 16 / 9]
  ] as const)('%s portrait=%s', (aspect, portrait, expected) => {
    expect(getAspectRatio(aspect, portrait, oriented)).toBe(expected)
  })
})

describe('getHandlePoints', () => {
  it('places 8 handles on an upright crop', () => {
    const points = getHandlePoints(centred, 0, oriented)
    expect(points).toHaveLength(8)
    const byId = Object.fromEntries(points.map((p) => [p.handle.id, p]))
    expect(byId.nw).toMatchObject({ x: 250, y: 125 })
    expect(byId.se).toMatchObject({ x: 750, y: 375 })
    expect(byId.e).toMatchObject({ x: 750, y: 250 })
  })

  it('turns the footprint against the straighten angle', () => {
    const points = getHandlePoints(centred, 10, oriented)
    const east = points.find((p) => p.handle.id === 'e')!
    // Positive straighten rotates the picture clockwise, so the crop's
    // footprint on the picture turns counterclockwise: the east handle rises.
    expect(east.y).toBeLessThan(250)
    expect(east.x).toBeGreaterThan(740)
  })
})

describe('resizeCrop', () => {
  it('drags the east edge and keeps the west edge', () => {
    const next = resizeCrop(
      centred,
      { x: 1, y: 0 },
      { x: 900, y: 250 },
      0,
      oriented,
      null
    )
    expect(next.x).toBeCloseTo(0.25, 5)
    expect(next.width).toBeCloseTo(0.65, 5)
    expect(next.height).toBeCloseTo(0.5, 5)
  })

  it('drags a corner of a free crop', () => {
    const next = resizeCrop(
      centred,
      { x: -1, y: -1 },
      { x: 100, y: 50 },
      0,
      oriented,
      null
    )
    expect(next.x).toBeCloseTo(0.1, 5)
    expect(next.y).toBeCloseTo(0.1, 5)
    expect(next.width).toBeCloseTo(0.65, 5)
    expect(next.height).toBeCloseTo(0.65, 5)
  })

  it('keeps the ratio of a corner drag', () => {
    const ratio = 2
    const start = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const next = resizeCrop(
      start,
      { x: 1, y: 1 },
      { x: 900, y: 300 },
      0,
      oriented,
      ratio
    )
    expect((next.width * 1000) / (next.height * 500)).toBeCloseTo(ratio, 5)
    expect(next.x).toBeCloseTo(0.25, 5)
  })

  it('keeps the ratio of an edge drag and centres the other axis', () => {
    const start = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const next = resizeCrop(
      start,
      { x: 1, y: 0 },
      { x: 850, y: 250 },
      0,
      oriented,
      2
    )
    expect((next.width * 1000) / (next.height * 500)).toBeCloseTo(2, 5)
    expect(next.y + next.height / 2).toBeCloseTo(0.5, 5)
  })

  it('does not grow past the image', () => {
    const next = resizeCrop(
      centred,
      { x: 1, y: 1 },
      { x: 5000, y: 5000 },
      0,
      oriented,
      null
    )
    expect(next.x + next.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(next.y + next.height).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('never shrinks below a minimum', () => {
    const next = resizeCrop(
      centred,
      { x: 1, y: 0 },
      { x: 0, y: 250 },
      0,
      oriented,
      null
    )
    expect(next.width).toBeGreaterThan(0)
    expect(next.width * 1000).toBeGreaterThanOrEqual(8)
  })

  it('stays inside the image when straightened', () => {
    const next = resizeCrop(
      full,
      { x: 1, y: 1 },
      { x: 1000, y: 500 },
      12,
      oriented,
      null
    )
    expect(next).toEqual(clampCropToImage(next, 12, oriented))
  })
})

describe('moveCrop', () => {
  it('moves and stops at the edges', () => {
    const moved = moveCrop(centred, 100, 0, 0, oriented)
    expect(moved.x).toBeCloseTo(0.35, 5)
    const stopped = moveCrop(centred, 5000, -5000, 0, oriented)
    expect(stopped.x + stopped.width).toBeCloseTo(1, 5)
    expect(stopped.y).toBeCloseTo(0, 5)
    expect(stopped.width).toBeCloseTo(0.5, 5)
  })
})
