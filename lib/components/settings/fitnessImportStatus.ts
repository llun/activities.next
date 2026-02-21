import { FitnessImportBatchFile } from '@/lib/client'

export type FitnessImportFileState = 'pending' | 'completed' | 'failed'

type FitnessImportFileStateInput = Pick<
  FitnessImportBatchFile,
  'importStatus' | 'processingStatus'
>

type FitnessImportFileErrorInput = Pick<
  FitnessImportBatchFile,
  'importStatus' | 'processingStatus' | 'importError'
>

export const getFitnessImportFileState = (
  file: FitnessImportFileStateInput
): FitnessImportFileState => {
  if (file.importStatus === 'failed' || file.processingStatus === 'failed') {
    return 'failed'
  }

  if (
    file.importStatus === 'pending' ||
    file.processingStatus === 'pending' ||
    file.processingStatus === 'processing'
  ) {
    return 'pending'
  }

  return 'completed'
}

export const getFitnessImportFileIcon = (
  state: FitnessImportFileState
): string => {
  if (state === 'failed') {
    return '❌'
  }

  if (state === 'completed') {
    return '✅'
  }

  return '⏳'
}

export const getFitnessImportFileError = (
  file: FitnessImportFileErrorInput
): string | null => {
  const state = getFitnessImportFileState(file)

  if (state !== 'failed') {
    return null
  }

  return file.importError ?? 'Processing failed during import'
}
