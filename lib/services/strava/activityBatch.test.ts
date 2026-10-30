import {
  STRAVA_ACTIVITY_BATCH_PREFIX,
  getStravaActivityIdFromBatchId
} from './activityBatch'

describe('getStravaActivityIdFromBatchId', () => {
  it.each([
    {
      description: 'extracts the activity id from a strava-activity batch',
      batchId: `${STRAVA_ACTIVITY_BATCH_PREFIX}19007245213`,
      expected: '19007245213'
    },
    {
      description: 'returns null for a manual upload batch',
      batchId: 'batch-1',
      expected: null
    },
    {
      description: 'returns null for a strava archive batch',
      batchId: 'strava-archive:archive-1',
      expected: null
    },
    {
      description: 'returns null when the activity id is empty',
      batchId: STRAVA_ACTIVITY_BATCH_PREFIX,
      expected: null
    }
  ])('$description', ({ batchId, expected }) => {
    expect(getStravaActivityIdFromBatchId(batchId)).toBe(expected)
  })
})
