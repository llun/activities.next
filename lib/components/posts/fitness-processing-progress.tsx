'use client'

import { LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { getFitnessProcessingState } from '@/lib/client'
import { Progress } from '@/lib/components/ui/progress'

type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface Props {
  statusId: string
  initialProcessingStatus: ProcessingStatus
  // Poll cadence; overridable so tests can drive it with fake timers.
  pollIntervalMs?: number
}

// A single fitness file is processed by one async job (parse + map render), so
// there is no real percentage to report. Instead we surface the coarse stage
// derived from the file's processing status, which reads as forward progress
// while the spinner conveys liveness.
const STAGES: Record<
  Extract<ProcessingStatus, 'pending' | 'processing'>,
  { label: string; percent: number }
> = {
  pending: { label: 'Queued for processing', percent: 25 },
  processing: { label: 'Generating route map', percent: 70 }
}

const isInFlight = (
  status: ProcessingStatus
): status is 'pending' | 'processing' =>
  status === 'pending' || status === 'processing'

export const FitnessProcessingProgress: FC<Props> = ({
  statusId,
  initialProcessingStatus,
  pollIntervalMs = 3_000
}) => {
  const router = useRouter()
  const [status, setStatus] = useState<ProcessingStatus>(
    initialProcessingStatus
  )

  useEffect(() => {
    // Gate on the initial prop, not the reactive `status`, so a poll's
    // setStatus() (which advances the label) does not tear down and reschedule
    // the poll loop. The loop self-terminates on a terminal/stuck response.
    if (!isInFlight(initialProcessingStatus)) return

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await getFitnessProcessingState(statusId)
        if (!active) return

        // No fitness file (e.g. deleted) or a terminal/stranded state: re-render
        // the post from the server so it shows the finished card or a retry
        // instead of this spinner. Stop polling without rescheduling.
        if (
          !next ||
          next.processingStatus === 'completed' ||
          next.processingStatus === 'failed' ||
          next.processingStuck
        ) {
          router.refresh()
          return
        }

        setStatus(next.processingStatus)
      } catch {
        // Transient fetch failure — keep polling.
      }

      if (active) {
        timer = setTimeout(poll, pollIntervalMs)
      }
    }

    timer = setTimeout(poll, pollIntervalMs)

    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [statusId, initialProcessingStatus, pollIntervalMs, router])

  const stage = isInFlight(status) ? STAGES[status] : STAGES.processing

  return (
    <div
      className="mt-2 flex flex-col gap-1.5"
      role="status"
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        <span>{stage.label}…</span>
      </div>
      <Progress value={stage.percent} className="h-1" />
    </div>
  )
}
