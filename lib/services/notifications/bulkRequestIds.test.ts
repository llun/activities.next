import {
  BulkNotificationRequestIdsBody,
  MAX_BULK_NOTIFICATION_REQUEST_IDS
} from './bulkRequestIds'

describe('BulkNotificationRequestIdsBody', () => {
  it.each([
    {
      description: 'an id array',
      input: { id: ['a', 'b'] },
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
})
