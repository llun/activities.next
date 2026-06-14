import { reorder } from '@/lib/components/admin-rules/reorder'

describe('reorder', () => {
  it.each([
    {
      description: 'moves an item down',
      list: ['a', 'b', 'c', 'd'],
      from: 0,
      to: 2,
      expected: ['b', 'c', 'a', 'd']
    },
    {
      description: 'moves an item up',
      list: ['a', 'b', 'c', 'd'],
      from: 3,
      to: 1,
      expected: ['a', 'd', 'b', 'c']
    },
    {
      description: 'moves to the first position',
      list: ['a', 'b', 'c'],
      from: 2,
      to: 0,
      expected: ['c', 'a', 'b']
    }
  ])('$description', ({ list, from, to, expected }) => {
    expect(reorder(list, from, to)).toEqual(expected)
  })

  it.each([
    { description: 'no-op when from equals to', from: 1, to: 1 },
    { description: 'negative from index', from: -1, to: 1 },
    { description: 'negative to index', from: 1, to: -1 },
    { description: 'from index out of range', from: 9, to: 1 },
    { description: 'to index out of range', from: 1, to: 9 }
  ])('returns the same reference for $description', ({ from, to }) => {
    const list = ['a', 'b', 'c']
    expect(reorder(list, from, to)).toBe(list)
  })
})
