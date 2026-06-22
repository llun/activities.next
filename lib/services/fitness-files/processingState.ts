import { FitnessProcessingStatus } from '@/lib/types/database/fitnessFile'

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
