import { Question } from '@/lib/types/activitypub/objects'

describe('Question', () => {
  const option = (name: string) => ({
    type: 'Note' as const,
    name,
    replies: { type: 'Collection' as const, totalItems: 0 }
  })

  const base = {
    id: 'https://remote.example/polls/1',
    type: 'Question' as const,
    attributedTo: 'https://remote.example/users/alice',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    content: 'Single option?',
    published: '2026-01-01T00:00:00Z',
    endTime: '2026-01-02T00:00:00Z'
  }

  // JSON-LD compaction collapses a single-option `oneOf`/`anyOf` array to a bare
  // object, so the schema must tolerate either shape and normalise to an array.
  it.each([
    { field: 'oneOf' as const, description: 'an array', input: [option('A')] },
    {
      field: 'oneOf' as const,
      description: 'a single collapsed object',
      input: option('A')
    },
    { field: 'anyOf' as const, description: 'an array', input: [option('A')] },
    {
      field: 'anyOf' as const,
      description: 'a single collapsed object',
      input: option('A')
    }
  ])(
    'accepts $field as $description and normalises to an array',
    ({ field, input }) => {
      const result = Question.safeParse({ ...base, [field]: input })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data[field]).toEqual([option('A')])
      }
    }
  )
})
