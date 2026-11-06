'use client'

import { FC, useEffect, useState } from 'react'

import {
  type ShareTargetSeed,
  useShareTargetIntake
} from '@/lib/client/share-target/useShareTargetIntake'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/services/fitness-files/constants'

interface Props {
  /** Whether this instance takes media uploads; off, shared media is skipped. */
  isMediaUploadEnabled: boolean
  /** Receives the files once the reader presses Add to post. */
  onSeed: (seed: ShareTargetSeed) => void
}

/**
 * Reads a Web Share Target handoff on `/app`, right above the top composer.
 * Any site can submit a share to this origin, so the files are never used on
 * arrival: they are listed with "Add to post" and "Discard", and only Add to
 * post hands them to the composer (`onSeed`), which uploads them. It also
 * renders the one-off notices (a share that could not be staged, or files that
 * were skipped). Renders nothing when there is no share.
 */
export const ShareTargetIntake: FC<Props> = ({
  isMediaUploadEnabled,
  onSeed
}) => {
  const { maxMediaFileSize, maxMediaAttachments } = useInstanceLimits()
  const { seed, pending, notice, unavailable, accept, discard } =
    useShareTargetIntake({
      enabled: true,
      limits: {
        maxMediaFileSize,
        maxFitnessFileSize: DEFAULT_FITNESS_MAX_FILE_SIZE,
        maxMediaAttachments,
        isMediaUploadEnabled
      }
    })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (seed) onSeed(seed)
  }, [seed, onSeed])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

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

  if (pending) {
    const names = [
      ...pending.media.map((file) => file.name),
      ...(pending.fitnessFile ? [pending.fitnessFile.name] : [])
    ]
    return (
      <div className="mb-3">
        <Alert
          tone="info"
          title={pending.summary}
          action={
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void run(accept)}
              >
                Add to post
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(discard)}
              >
                Discard
              </Button>
            </div>
          }
        >
          <ul aria-label="Shared files" className="break-all">
            {names.map((name, index) => (
              <li key={`${index}-${name}`}>{name}</li>
            ))}
          </ul>
          {notice ? <p className="mt-1">{notice}</p> : null}
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
