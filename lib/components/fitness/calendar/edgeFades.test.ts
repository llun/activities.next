import { ANNUAL_LABEL_WIDTH } from '@/lib/fitness/calendar/geometry'

import { ANNUAL_SNAP_PADDING, edgeFades, sameEdgeFades } from './edgeFades'

describe('edge fades', () => {
  it.each([
    {
      name: 'nothing is hidden when the grid fits',
      metrics: { scrollLeft: 0, clientWidth: 600, scrollWidth: 600 },
      expected: { start: false, end: false }
    },
    {
      name: 'a sub-pixel overflow is not hidden content',
      metrics: { scrollLeft: 0, clientWidth: 600, scrollWidth: 600.5 },
      expected: { start: false, end: false }
    },
    {
      name: 'only the end fades at scroll position 0',
      metrics: { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 },
      expected: { start: false, end: true }
    },
    {
      name: 'both sides fade in the middle',
      metrics: { scrollLeft: 350, clientWidth: 300, scrollWidth: 1000 },
      expected: { start: true, end: true }
    },
    {
      name: 'only the start fades at the end, so the fade is never over today',
      metrics: { scrollLeft: 700, clientWidth: 300, scrollWidth: 1000 },
      expected: { start: true, end: false }
    },
    {
      name: 'a sub-pixel gap before the end counts as the end',
      metrics: { scrollLeft: 699.4, clientWidth: 300, scrollWidth: 1000 },
      expected: { start: true, end: false }
    },
    {
      name: 'a sub-pixel scroll off the start is still the start',
      metrics: { scrollLeft: 0.6, clientWidth: 300, scrollWidth: 1000 },
      expected: { start: false, end: true }
    }
  ])('$name', ({ metrics, expected }) => {
    expect(edgeFades(metrics)).toEqual(expected)
  })

  it('compares two states by value', () => {
    expect(
      sameEdgeFades({ start: true, end: false }, { start: true, end: false })
    ).toBe(true)
    expect(
      sameEdgeFades({ start: true, end: false }, { start: true, end: true })
    ).toBe(false)
  })

  it('pads the snap line by the sticky label column plus the fade', () => {
    expect(ANNUAL_SNAP_PADDING).toBe(ANNUAL_LABEL_WIDTH + 16)
  })
})
