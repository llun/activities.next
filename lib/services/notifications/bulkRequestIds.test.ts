import {
  BulkNotificationRequestIdsBody,
  MAX_BULK_NOTIFICATION_REQUEST_IDS
} from './bulkRequestIds'

const overCapIds = () =>
  Array.from(
    { length: MAX_BULK_NOTIFICATION_REQUEST_IDS + 1 },
    (_, index) => `id-${index}`
  )

describe('BulkNotificationRequestIdsBody', () => {
  it.each([
    { description: 'an absent body', input: {}, expected: [] },
    { description: 'a single id string', input: { id: 'a' }, expected: ['a'] },
    {
      description: 'an id array',
      input: { id: ['a', 'b'] },
      expected: ['a', 'b']
    },
    {
      description: 'a bracketed id[] array',
      input: { 'id[]': ['a', 'b'] },
      expected: ['a', 'b']
    },
    {
      description: 'id winning over id[] when both are sent',
      input: { id: ['a'], 'id[]': ['b'] },
      expected: ['a']
    },
    {
      description: 'a list exactly at the cap',
      input: {
        id: Array.from(
          { length: MAX_BULK_NOTIFICATION_REQUEST_IDS },
          (_, index) => `id-${index}`
        )
      },
      expected: Array.from(
        { length: MAX_BULK_NOTIFICATION_REQUEST_IDS },
        (_, index) => `id-${index}`
      )
    }
  ])('normalizes $description', ({ input, expected }) => {
    const parsed = BulkNotificationRequestIdsBody.safeParse(input)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toEqual(expected)
  })

  it.each([
    { description: 'the id field', input: { id: overCapIds() } },
    { description: 'the id[] field', input: { 'id[]': overCapIds() } }
  ])('rejects an over-cap list in $description', ({ input }) => {
    expect(BulkNotificationRequestIdsBody.safeParse(input).success).toBe(false)
  })
})
