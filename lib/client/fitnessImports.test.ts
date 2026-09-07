import fetchMock from 'jest-fetch-mock'

import {
  cancelStravaArchiveImport,
  createStravaArchivePresignedUrl,
  getActiveStravaArchiveImport,
  retryStravaArchiveImport,
  startFitnessImport,
  startStravaArchiveImport,
  uploadFitnessFile
} from '@/lib/client/fitnessImports'

describe('fitnessImports client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('uploadFitnessFile', () => {
    it('uploads fitness file via FormData and returns result', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'fitness-file-1',
          type: 'fitness',
          file_type: 'fit',
          mime_type: 'application/vnd.ant.fit',
          url: 'https://llun.test/files/1.fit',
          fileName: 'run.fit',
          size: 1234
        }),
        { status: 200 }
      )

      const file = new File(['mock content'], 'run.fit', {
        type: 'application/vnd.ant.fit'
      })
      const result = await uploadFitnessFile(file, 'Morning run')

      expect(result.id).toBe('fitness-file-1')
      expect(result.fileName).toBe('run.fit')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness-files',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('throws error when upload fails', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid fit file' }),
        {
          status: 400
        }
      )

      const file = new File(['invalid'], 'bad.fit')
      await expect(uploadFitnessFile(file)).rejects.toThrow(
        'Failed to upload fitness file: 400 Invalid fit file'
      )
    })
  })

  describe('startFitnessImport', () => {
    it('sends files and visibility via FormData', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          batchId: 'batch-1',
          fileCount: 2
        }),
        { status: 200 }
      )

      const file1 = new File(['content1'], '1.fit')
      const file2 = new File(['content2'], '2.fit')
      const result = await startFitnessImport([file1, file2], 'public')

      expect(result.batchId).toBe('batch-1')
      expect(result.fileCount).toBe(2)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/import',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('throws error when start import fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Too many files' }), {
        status: 422
      })

      const file = new File(['content'], '1.fit')
      await expect(startFitnessImport([file], 'public')).rejects.toThrow(
        'Failed to import fitness files: 422 Too many files'
      )
    })
  })

  describe('createStravaArchivePresignedUrl', () => {
    it('returns null on 404', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })
      const file = new File(['zip'], 'export.zip', { type: 'application/zip' })
      const result = await createStravaArchivePresignedUrl(file)
      expect(result).toBeNull()
    })

    it('returns presigned output on success', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          presigned: {
            url: 'https://storage/upload',
            fitnessFileId: 'fit-1',
            archiveId: 'arch-1'
          }
        }),
        { status: 200 }
      )
      const file = new File(['zip'], 'export.zip', { type: 'application/zip' })
      const result = await createStravaArchivePresignedUrl(file)
      expect(result?.presigned.url).toBe('https://storage/upload')
    })
  })

  describe('startStravaArchiveImport', () => {
    it('does not fall back to multipart upload when presigned setup is rejected', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'active import' }), {
        status: 409
      })

      await expect(
        startStravaArchiveImport(
          new File([Buffer.from('zip-data')], 'export.zip', {
            type: 'application/zip'
          }),
          'private'
        )
      ).rejects.toThrow('Failed to get presigned URL for archive')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava/archive/presigned',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('does not fall back to multipart upload when presigned import commit is rejected', async () => {
      fetchMock
        .mockResponseOnce(
          JSON.stringify({
            presigned: {
              url: 'https://storage.example/archive.zip',
              fitnessFileId: 'fitness-file-1',
              archiveId: 'archive-1'
            }
          }),
          { status: 200 }
        )
        .mockResponseOnce('', { status: 200 })
        .mockResponseOnce(JSON.stringify({ error: 'active import' }), {
          status: 409
        })

      await expect(
        startStravaArchiveImport(
          new File([Buffer.from('zip-data')], 'export.zip', {
            type: 'application/zip'
          }),
          'private'
        )
      ).rejects.toThrow('Failed to start Strava archive import')

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        '/api/v1/fitness/strava/archive',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })
  })

  describe('getActiveStravaArchiveImport', () => {
    it('fetches active strava archive import', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          activeImport: {
            id: 'import-1',
            status: 'importing'
          }
        }),
        { status: 200 }
      )

      const result = await getActiveStravaArchiveImport()
      expect(result.activeImport?.id).toBe('import-1')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava/archive',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws on failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not authorized' }), {
        status: 401
      })

      await expect(getActiveStravaArchiveImport()).rejects.toThrow(
        'Not authorized'
      )
    })
  })

  describe('retryStravaArchiveImport', () => {
    it('sends PATCH with action retry', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          activeImport: { id: 'import-1', status: 'importing' }
        }),
        { status: 200 }
      )

      const result = await retryStravaArchiveImport()
      expect(result.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava/archive',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'retry' })
        })
      )
    })
  })

  describe('cancelStravaArchiveImport', () => {
    it('sends PATCH with action cancel', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          cancelled: true
        }),
        { status: 200 }
      )

      const result = await cancelStravaArchiveImport()
      expect(result.cancelled).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava/archive',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' })
        })
      )
    })
  })
})
