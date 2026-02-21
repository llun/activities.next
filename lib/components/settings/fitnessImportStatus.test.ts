import {
  getFitnessImportFileError,
  getFitnessImportFileIcon,
  getFitnessImportFileState
} from './fitnessImportStatus'

describe('fitnessImportStatus', () => {
  describe('getFitnessImportFileState', () => {
    it('returns failed when processing status fails after import completed', () => {
      expect(
        getFitnessImportFileState({
          importStatus: 'completed',
          processingStatus: 'failed'
        })
      ).toBe('failed')
    })

    it('returns pending when processing is still running', () => {
      expect(
        getFitnessImportFileState({
          importStatus: 'completed',
          processingStatus: 'processing'
        })
      ).toBe('pending')
    })

    it('returns completed when both import and processing complete', () => {
      expect(
        getFitnessImportFileState({
          importStatus: 'completed',
          processingStatus: 'completed'
        })
      ).toBe('completed')
    })
  })

  describe('getFitnessImportFileIcon', () => {
    it('maps states to display icons', () => {
      expect(getFitnessImportFileIcon('failed')).toBe('❌')
      expect(getFitnessImportFileIcon('pending')).toBe('⏳')
      expect(getFitnessImportFileIcon('completed')).toBe('✅')
    })
  })

  describe('getFitnessImportFileError', () => {
    it('returns fallback error when failed by processing without importError', () => {
      expect(
        getFitnessImportFileError({
          importStatus: 'completed',
          processingStatus: 'failed',
          importError: null
        })
      ).toBe('Processing failed during import')
    })

    it('prefers importError when available', () => {
      expect(
        getFitnessImportFileError({
          importStatus: 'failed',
          processingStatus: 'pending',
          importError: 'Invalid GPX data'
        })
      ).toBe('Invalid GPX data')
    })

    it('returns null when file is not failed', () => {
      expect(
        getFitnessImportFileError({
          importStatus: 'completed',
          processingStatus: 'completed',
          importError: null
        })
      ).toBeNull()
    })
  })
})
