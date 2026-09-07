import fetchMock from 'jest-fetch-mock'

import {
  getAppleMapsToken,
  getFitnessFilesByStatus,
  getFitnessImportBatch,
  getFitnessProcessingState,
  retryFitnessImportBatch
} from '@/lib/client/fitnessFiles'

describe('fitnessFiles client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFitnessImportBatch', () => {
    it('fetches fitness import batch data', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          batchId: 'batch-123',
          status: 'completed',
          summary: { total: 1, pending: 0, completed: 1, failed: 0 },
          files: []
        }),
        { status: 200 }
      )

      const result = await getFitnessImportBatch('batch-123')
      expect(result.batchId).toBe('batch-123')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/import/batch-123',
        expect.objectContaining({
          method: 'GET'
        })
      )
    })

    it('throws error when request fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not found' }), {
        status: 404
      })

      await expect(getFitnessImportBatch('batch-999')).rejects.toThrow(
        'Not found'
      )
    })
  })

  describe('retryFitnessImportBatch', () => {
    it('posts retry request with visibility', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ batchId: 'batch-123', retried: 2 }),
        { status: 200 }
      )

      const result = await retryFitnessImportBatch('batch-123', 'public')
      expect(result.retried).toBe(2)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/import/batch-123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ visibility: 'public' })
        })
      )
    })

    it('throws error when retry fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      await expect(
        retryFitnessImportBatch('batch-123', 'public')
      ).rejects.toThrow('Server error')
    })
  })

  describe('getFitnessProcessingState', () => {
    it('returns processing state for primary file', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          files: [
            {
              isPrimary: true,
              processingStatus: 'completed',
              processingStuck: false,
              hasMapData: true
            }
          ]
        }),
        { status: 200 }
      )

      const state = await getFitnessProcessingState('status-1')
      expect(state).toEqual({
        processingStatus: 'completed',
        processingStuck: false,
        hasMapData: true
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness-files/by-status?statusId=status-1',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns null when no files found', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ files: [] }), { status: 200 })

      const state = await getFitnessProcessingState('status-empty')
      expect(state).toBeNull()
    })

    it('throws when endpoint returns error', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Failed' }), {
        status: 500
      })

      await expect(getFitnessProcessingState('status-err')).rejects.toThrow(
        'Failed'
      )
    })
  })

  describe('getFitnessFilesByStatus', () => {
    it('returns list of fitness files', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          files: [
            {
              id: 'file-1',
              fileName: 'run.fit',
              fileType: 'fit',
              isPrimary: true
            }
          ]
        }),
        { status: 200 }
      )

      const files = await getFitnessFilesByStatus('status-1')
      expect(files).toHaveLength(1)
      expect(files?.[0].id).toBe('file-1')
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      const files = await getFitnessFilesByStatus('status-err')
      expect(files).toBeNull()
    })
  })

  describe('getAppleMapsToken', () => {
    it('returns token on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ token: 'test-token' }), {
        status: 200
      })

      const token = await getAppleMapsToken()
      expect(token).toBe('test-token')
    })

    it('returns null on error status', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not configured' }), {
        status: 404
      })

      const token = await getAppleMapsToken()
      expect(token).toBeNull()
    })

    it('returns null on network exception', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      const token = await getAppleMapsToken()
      expect(token).toBeNull()
    })
  })
})
