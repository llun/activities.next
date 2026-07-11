import {
  FitnessImportStatus,
  FitnessProcessingStatus
} from '@/lib/types/database/fitnessFile'

// A fitness file is moved to `processing` the moment the job starts and is
// flipped to `completed`/`failed` only inside the job's try/catch. When the
// worker is killed mid-job (e.g. OOM, deploy SIGTERM, timeout) the process
// dies before either write lands — which is NOT a catchable error — so the
// file is stranded in `processing` forever. Anything still `processing` past
// this threshold is treated as stuck and eligible for retry. Real processing
// completes in seconds, so a generous window avoids racing a genuinely
// in-flight job.
export const STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000

interface FitnessProcessingState {
  processingStatus?: FitnessProcessingStatus | null
  // Milliseconds since epoch of the last processing-status write. Callers must
  // normalize raw SQL timestamps (e.g. via getCompatibleTime) before passing.
  updatedAt: number
}

export const isFitnessProcessingStuck = (
  file: FitnessProcessingState,
  now: number = Date.now()
): boolean => {
  if (file.processingStatus !== 'processing') return false
  return now - file.updatedAt >= STUCK_PROCESSING_THRESHOLD_MS
}

// The import side has the mirror problem. A fitness file backed by an import
// batch is created at `importStatus='pending'` with no `statusId`, and only
// flips to `completed` (status assigned) or `failed` (inside the importer's
// catch). A SIGABRT/OOM kills the importer before either write lands — an
// uncatchable death — so the file is stranded `pending` with no `statusId`
// forever, and every `failed`-only retry filter misses it. Anything still
// import-`pending` with no status past the same threshold is treated as a stuck
// import eligible for retry. Only files that carry an `importBatchId` qualify,
// because the retry path re-runs the batch.
interface FitnessImportState {
  importStatus?: FitnessImportStatus | null
  statusId?: string | null
  importBatchId?: string | null
  // Milliseconds since epoch of the last write. Callers must normalize raw SQL
  // timestamps (e.g. via getCompatibleTime) before passing.
  updatedAt: number
}

export const isFitnessImportStuck = (
  file: FitnessImportState,
  now: number = Date.now()
): boolean => {
  if (file.importStatus !== 'pending') return false
  if (file.statusId) return false
  if (!file.importBatchId) return false
  return now - file.updatedAt >= STUCK_PROCESSING_THRESHOLD_MS
}
