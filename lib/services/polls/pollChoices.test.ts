import { describe, expect, it } from 'vitest'

import { Question } from '@/lib/types/activitypub'

import {
  getPollChoicesFromQuestion,
  getPollEndAtFromQuestion,
  getPollFieldsFromQuestion
} from './pollChoices'

const buildQuestion = (overrides: Record<string, unknown>): Question =>
  Question.parse({
    id: 'https://remote.example/statuses/1',
    type: 'Question',
    attributedTo: 'https://remote.example/users/alice',
    to: 'https://www.w3.org/ns/activitystreams#Public',
    cc: [],
    published: '2026-01-01T00:00:00Z',
    ...overrides
  })

describe('getPollChoicesFromQuestion', () => {
  it('prefers oneOf over anyOf when both are present', () => {
    const question = buildQuestion({
      oneOf: [
        {
          type: 'Note',
          name: 'Single',
          replies: { type: 'Collection', totalItems: 1 }
        }
      ],
      anyOf: [
        {
          type: 'Note',
          name: 'Multi',
          replies: { type: 'Collection', totalItems: 9 }
        }
      ]
    })

    expect(getPollChoicesFromQuestion(question)).toEqual([
      { title: 'Single', totalVotes: 1 }
    ])
  })

  it('defaults totalVotes to 0 when an option has no replies collection', () => {
    const question = buildQuestion({
      oneOf: [{ type: 'Note', name: 'Untallied' }]
    })

    expect(getPollChoicesFromQuestion(question)).toEqual([
      { title: 'Untallied', totalVotes: 0 }
    ])
  })

  it('takes the stored tally by position for an option without replies, so duplicate titles keep their own', () => {
    const question = buildQuestion({
      oneOf: [
        { type: 'Note', name: 'Same' },
        { type: 'Note', name: 'Same' },
        {
          type: 'Note',
          name: 'Counted',
          replies: { type: 'Collection', totalItems: 2 }
        },
        { type: 'Note', name: 'Added' }
      ]
    })

    expect(
      getPollChoicesFromQuestion(question, [
        { title: 'Same', totalVotes: 5 },
        { title: 'Same', totalVotes: 1 },
        { title: 'Counted', totalVotes: 9 }
      ])
    ).toEqual([
      { title: 'Same', totalVotes: 5 },
      { title: 'Same', totalVotes: 1 },
      { title: 'Counted', totalVotes: 2 },
      { title: 'Added', totalVotes: 0 }
    ])
  })

  it('returns an empty list when the question carries neither oneOf nor anyOf', () => {
    const question = buildQuestion({})

    expect(getPollChoicesFromQuestion(question)).toEqual([])
  })
})

describe('getPollEndAtFromQuestion', () => {
  it('reads endTime and treats an unparseable one as no deadline', () => {
    expect(
      getPollEndAtFromQuestion(
        buildQuestion({ endTime: '2026-09-05T00:00:00Z' })
      )
    ).toEqual(Date.UTC(2026, 8, 5))
    expect(
      getPollEndAtFromQuestion(buildQuestion({ endTime: 'not-a-date' }))
    ).toBeUndefined()
    expect(getPollEndAtFromQuestion(buildQuestion({}))).toBeUndefined()
  })

  it('prefers a parseable string closed, falls back to endTime for a bad one', () => {
    expect(
      getPollEndAtFromQuestion(
        buildQuestion({
          endTime: '2026-09-05T00:00:00Z',
          closed: '2026-09-01T00:00:00Z'
        })
      )
    ).toEqual(Date.UTC(2026, 8, 1))
    expect(
      getPollEndAtFromQuestion(
        buildQuestion({ endTime: '2026-09-05T00:00:00Z', closed: 'soon' })
      )
    ).toEqual(Date.UTC(2026, 8, 5))
  })

  it('closes the poll now for a boolean closed, unless it is already closed', () => {
    const before = Date.now()
    const endAt = getPollEndAtFromQuestion(
      buildQuestion({ endTime: '2099-09-05T00:00:00Z', closed: true })
    )
    expect(endAt).toBeGreaterThanOrEqual(before)
    expect(endAt).toBeLessThanOrEqual(Date.now())
    // A stored deadline still ahead is closed now; one already past is kept.
    expect(
      getPollEndAtFromQuestion(
        buildQuestion({ closed: true }),
        Date.now() + 60_000
      )
    ).toBeLessThanOrEqual(Date.now())
    expect(
      getPollEndAtFromQuestion(buildQuestion({ closed: true }), 1_000)
    ).toEqual(1_000)
    expect(
      getPollEndAtFromQuestion(
        buildQuestion({ endTime: '2026-09-05T00:00:00Z', closed: false })
      )
    ).toEqual(Date.UTC(2026, 8, 5))
  })
})

describe('getPollFieldsFromQuestion', () => {
  it('carries the updated the poll was first seen with, undefined when absent or bad', () => {
    const publishedAt = Date.UTC(2026, 0, 1)
    expect(
      getPollFieldsFromQuestion(
        buildQuestion({ updated: '2026-02-01T00:00:00Z' }),
        publishedAt
      ).remoteUpdatedAt
    ).toEqual(Date.UTC(2026, 1, 1))
    expect(
      getPollFieldsFromQuestion(buildQuestion({}), publishedAt).remoteUpdatedAt
    ).toBeUndefined()
    expect(
      getPollFieldsFromQuestion(buildQuestion({ updated: 'bad' }), publishedAt)
        .remoteUpdatedAt
    ).toBeUndefined()
  })

  it('keeps a new poll with an unparseable endTime open like one without', () => {
    const publishedAt = Date.UTC(2026, 0, 1)
    expect(
      getPollFieldsFromQuestion(
        buildQuestion({ endTime: 'not-a-date' }),
        publishedAt
      ).endAt
    ).toEqual(getPollFieldsFromQuestion(buildQuestion({}), publishedAt).endAt)
  })
})
