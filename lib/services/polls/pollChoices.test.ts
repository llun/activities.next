import { describe, expect, it } from 'vitest'

import { Question } from '@/lib/types/activitypub'

import { getPollChoicesFromQuestion } from './pollChoices'

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

  it('returns an empty list when the question carries neither oneOf nor anyOf', () => {
    const question = buildQuestion({})

    expect(getPollChoicesFromQuestion(question)).toEqual([])
  })
})
