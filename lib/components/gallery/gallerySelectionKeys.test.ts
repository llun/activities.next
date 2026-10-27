import { describe, expect, it, vi } from 'vitest'

import {
  applyRangeSelection,
  describeRangeResult,
  getGridColumnCount,
  moveGridFocus
} from '@/lib/components/gallery/gallerySelectionKeys'

const select = (
  overrides: Partial<Parameters<typeof applyRangeSelection>[0]>
) =>
  applyRangeSelection({
    order: ['a', 'b', 'c', 'd', 'e'],
    anchorId: 'b',
    targetId: 'd',
    select: true,
    selected: new Set(['b']),
    blocked: new Set(),
    room: Infinity,
    ...overrides
  })

describe('applyRangeSelection', () => {
  it('adds the unpicked ids between anchor and target', () => {
    expect(select({})).toEqual({
      added: ['c', 'd'],
      removed: [],
      hitRoom: false
    })
  })

  it('works in either direction', () => {
    expect(select({ anchorId: 'd', targetId: 'b' })).toEqual({
      added: ['c', 'd'],
      removed: [],
      hitRoom: false
    })
  })

  it('treats the order as flat, across day groups', () => {
    expect(
      select({
        order: ['d1', 'd2', 'd3', 'u1', 'u2', 'd4'],
        anchorId: 'd2',
        targetId: 'd4',
        selected: new Set(['d2'])
      })
    ).toEqual({ added: ['d3', 'u1', 'u2', 'd4'], removed: [], hitRoom: false })
  })

  it('unpicks a run', () => {
    expect(
      select({
        select: false,
        selected: new Set(['c', 'd', 'e'])
      })
    ).toEqual({ added: [], removed: ['c', 'd'], hitRoom: false })
  })

  it('skips blocked ids while picking', () => {
    expect(
      select({
        blocked: new Set(['c'])
      })
    ).toEqual({ added: ['d'], removed: [], hitRoom: false })
  })

  it('stops at room and reports it', () => {
    expect(
      select({
        anchorId: 'a',
        targetId: 'e',
        selected: new Set(['a']),
        room: 2
      })
    ).toEqual({ added: ['b', 'c'], removed: [], hitRoom: true })
  })

  it('does not report room when the range fits exactly', () => {
    expect(
      select({
        anchorId: 'a',
        targetId: 'c',
        selected: new Set(['a']),
        room: 2
      })
    ).toEqual({ added: ['b', 'c'], removed: [], hitRoom: false })
  })

  it('handles anchor === target', () => {
    expect(
      select({ anchorId: 'c', targetId: 'c', selected: new Set(['c']) })
    ).toEqual({ added: [], removed: [], hitRoom: false })
    expect(
      select({
        anchorId: 'c',
        targetId: 'c',
        select: false,
        selected: new Set(['c'])
      })
    ).toEqual({ added: [], removed: ['c'], hitRoom: false })
  })

  it('is a no-op when an id is missing from the order', () => {
    expect(select({ anchorId: 'zz' })).toEqual({
      added: [],
      removed: [],
      hitRoom: false
    })
    expect(select({ targetId: 'zz' })).toEqual({
      added: [],
      removed: [],
      hitRoom: false
    })
  })
})

describe('describeRangeResult', () => {
  it.each([
    {
      label: 'added',
      result: { added: ['a', 'b'], removed: [], hitRoom: false },
      expected: 'Selected 2 photos'
    },
    {
      label: 'added one',
      result: { added: ['a'], removed: [], hitRoom: false },
      expected: 'Selected 1 photo'
    },
    {
      label: 'removed',
      result: { added: [], removed: ['a', 'b', 'c', 'd', 'e'], hitRoom: false },
      expected: 'Deselected 5 photos'
    },
    {
      label: 'added until the album is full',
      result: { added: ['a', 'b', 'c'], removed: [], hitRoom: true },
      expected: 'Selected 3 photos, the album is full'
    },
    {
      label: 'nothing',
      result: { added: [], removed: [], hitRoom: false },
      expected: 'Nothing to change'
    }
  ])('$label', ({ result, expected }) => {
    expect(describeRangeResult(result)).toBe(expected)
  })
})

describe('moveGridFocus', () => {
  it.each([
    { index: 2, key: 'ArrowRight', count: 5, columns: 3, expected: 3 },
    { index: 4, key: 'ArrowRight', count: 5, columns: 3, expected: 4 },
    { index: 0, key: 'ArrowLeft', count: 5, columns: 3, expected: 0 },
    { index: 3, key: 'ArrowUp', count: 5, columns: 3, expected: 0 },
    { index: 1, key: 'ArrowDown', count: 5, columns: 3, expected: 4 },
    { index: 0, key: 'ArrowDown', count: 5, columns: 3, expected: 3 },
    { index: 2, key: 'Home', count: 5, columns: 3, expected: 0 },
    { index: 2, key: 'End', count: 5, columns: 3, expected: 4 },
    { index: 2, key: 'Enter', count: 5, columns: 3, expected: null },
    { index: 2, key: ' ', count: 5, columns: 3, expected: null },
    { index: 0, key: 'ArrowUp', count: 1, columns: 1, expected: 0 }
  ])(
    'index $index key $key count $count columns $columns',
    ({ index, key, count, columns, expected }) => {
      expect(moveGridFocus(index, key, count, columns)).toBe(expected)
    }
  )

  it.each([
    {
      index: 0,
      key: 'ArrowDown',
      groupSizes: [1, 5],
      expected: 1
    },
    {
      index: 3,
      key: 'ArrowUp',
      groupSizes: [1, 5],
      expected: 0
    },
    {
      index: 2,
      key: 'ArrowRight',
      groupSizes: [1, 5],
      expected: 3
    }
  ])(
    'moves $key from flat index $index across day groups',
    ({ index, key, groupSizes, expected }) => {
      expect(moveGridFocus(index, key, 6, 3, groupSizes)).toBe(expected)
    }
  )
})

describe('getGridColumnCount', () => {
  it.each([
    { template: '1fr 1fr 1fr 1fr', expected: 4 },
    { template: '1fr 1fr', expected: 2 },
    { template: '', expected: 1 }
  ])('$template -> $expected', ({ template, expected }) => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({ gridTemplateColumns: template }))
    )
    try {
      expect(getGridColumnCount({} as Element)).toBe(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
