import { RRF_K, fuseRankings } from './statuses'

describe('fuseRankings', () => {
  it('returns an empty list for empty inputs', () => {
    expect(fuseRankings([])).toEqual([])
    expect(fuseRankings([[], []])).toEqual([])
  })

  it('preserves a single ranking unchanged', () => {
    expect(fuseRankings([['first', 'second', 'third']])).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  it('orders results by reciprocal rank fusion score with k=60', () => {
    expect(RRF_K).toBe(60)
    // Shared rank-2/rank-2 doc scores 2/(60+2) = 0.03226, beating single-list
    // rank-1 docs which score 1/(60+1) = 0.01639.
    const keyword = ['kw-only-1', 'both-2', 'kw-only-3']
    const semantic = ['sem-only-1', 'both-2', 'sem-only-3']

    expect(fuseRankings([keyword, semantic])).toEqual([
      'both-2',
      'kw-only-1',
      'sem-only-1',
      'kw-only-3',
      'sem-only-3'
    ])
  })

  it('merges a vector-only id into its RRF rank among keyword hits', () => {
    // kw-only-1 (rank 1 kw: 1/61) and vector-only (rank 1 sem: 1/61) tie on
    // score, so keyword wins the tie, then vector-only beats kw-only-2 (1/62).
    const keyword = ['kw-only-1', 'kw-only-2', 'kw-only-3']
    const semantic = ['vector-only', 'kw-only-3']

    // kw-only-3: 1/63 + 1/62 = 0.03200
    // kw-only-1: 1/61        = 0.01639 (list 0, index 0)
    // vector-only: 1/61      = 0.01639 (list 1, index 0)
    // kw-only-2: 1/62        = 0.01613
    expect(fuseRankings([keyword, semantic])).toEqual([
      'kw-only-3',
      'kw-only-1',
      'vector-only',
      'kw-only-2'
    ])
  })

  it('breaks equal RRF scores in favor of the earlier list and earlier rank', () => {
    const keyword = ['a-first', 'b-second']
    const semantic = ['z-first', 'y-second']

    expect(fuseRankings([keyword, semantic])).toEqual([
      'a-first',
      'z-first',
      'b-second',
      'y-second'
    ])
  })

  it('returns semantic-only results when the keyword list is empty', () => {
    expect(fuseRankings([[], ['sem-1', 'sem-2']])).toEqual(['sem-1', 'sem-2'])
  })
})
