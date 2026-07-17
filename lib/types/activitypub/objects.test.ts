import { Note, Question } from '@/lib/types/activitypub/objects'

describe('Note quote fields', () => {
  const base = {
    id: 'https://remote.example/notes/1',
    type: 'Note' as const,
    attributedTo: 'https://remote.example/users/alice',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    content: 'quoting',
    published: '2026-01-01T00:00:00Z'
  }

  it('accepts a string quote target', () => {
    const result = Note.safeParse({
      ...base,
      quote: 'https://llun.test/users/me/statuses/1'
    })
    expect(result.success).toBe(true)
  })

  it('accepts an embedded quote object without an id instead of rejecting the whole note', () => {
    // Liberal-inbound mandate: an unusual/blank-node quote value must never drop
    // the entire note.
    const result = Note.safeParse({
      ...base,
      quote: { type: 'Link', href: 'https://llun.test/users/me/statuses/1' }
    })
    expect(result.success).toBe(true)
  })
})

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
