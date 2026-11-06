'use client'

import { FC, useEffect } from 'react'

import {
  type ShareTargetSeed,
  useShareTargetIntake
} from '@/lib/client/share-target/useShareTargetIntake'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Alert } from '@/lib/components/surface/Alert'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/services/fitness-files/constants'

interface Props {
  /** Receives the files once, for the top composer. */
  onSeed: (seed: ShareTargetSeed) => void
}

/**
 * Reads a Web Share Target handoff on `/app` and reports what it found. It
 * renders the one-off notices itself (a share that could not be staged, or
 * files that were skipped) and hands the files to the composer through
 * `onSeed`. Renders nothing when there is no share.
 */
export const ShareTargetIntake: FC<Props> = ({ onSeed }) => {
  const { maxMediaFileSize, maxMediaAttachments } = useInstanceLimits()
  const { seed, notice, unavailable } = useShareTargetIntake({
    enabled: true,
    limits: {
      maxMediaFileSize,
      maxFitnessFileSize: DEFAULT_FITNESS_MAX_FILE_SIZE,
      maxMediaAttachments
    }
  })

  useEffect(() => {
    if (seed) onSeed(seed)
  }, [seed, onSeed])

  if (unavailable) {
    return (
      <div className="mb-3">
        <Alert tone="info" title="Shared files weren't attached">
          The share arrived before the app was ready on this device. Share the
          files again to attach them.
        </Alert>
      </div>
    )
  }

  if (notice) {
    return (
      <div className="mb-3">
        <Alert tone="info" title="Some shared files were skipped">
          {notice}
        </Alert>
      </div>
    )
  }

  return null
}
