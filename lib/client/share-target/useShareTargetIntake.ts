'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  type ShareTargetLimits,
  classifySharedFiles,
  describeSkippedFiles
} from './classify'
import { peekStagedShare, takeStagedShare, toShareFiles } from './shareTargetDb'

export const SHARE_PARAM = 'share'
export const SHARE_UNAVAILABLE_PARAM = 'shareUnavailable'

export interface ShareTargetSeed {
  media: File[]
  fitnessFile?: File
}

export interface ShareTargetIntakeState {
  /** Files to hand to the composer, once. */
  seed: ShareTargetSeed | null
  /** A one-off note about files that were skipped. */
  notice: string | null
  /** The share arrived before the worker could stage it, or it expired. */
  unavailable: boolean
}

const readParams = () =>
  typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search)

// Removes the one-time share parameters, as the `?media=` seeding does, so a
// reload does not try to consume the same share again.
const stripShareParams = () => {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (
    !url.searchParams.has(SHARE_PARAM) &&
    !url.searchParams.has(SHARE_UNAVAILABLE_PARAM)
  ) {
    return
  }
  url.searchParams.delete(SHARE_PARAM)
  url.searchParams.delete(SHARE_UNAVAILABLE_PARAM)
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`
  )
}

/**
 * Reads the staged share named by `?share=<id>` once. Media and a single
 * workout come back as a composer seed; two or more workouts hand the record to
 * `/fitness/files`, which consumes it there. The record is deleted after it is
 * read, and the query parameter is stripped from the URL.
 */
export function useShareTargetIntake({
  enabled,
  limits
}: {
  enabled: boolean
  limits: ShareTargetLimits
}): ShareTargetIntakeState {
  const router = useRouter()
  const [state, setState] = useState<ShareTargetIntakeState>({
    seed: null,
    notice: null,
    unavailable: false
  })
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || startedRef.current) return
    const params = readParams()
    const unavailable = params.has(SHARE_UNAVAILABLE_PARAM)
    const id = params.get(SHARE_PARAM)
    if (!unavailable && !id) return

    startedRef.current = true
    stripShareParams()

    if (unavailable || !id) {
      setState({ seed: null, notice: null, unavailable: true })
      return
    }

    void (async () => {
      const share = await peekStagedShare(id)
      if (!share) {
        setState({ seed: null, notice: null, unavailable: true })
        return
      }

      const plan = classifySharedFiles(toShareFiles(share), limits)
      if (plan.kind === 'import') {
        // The import page consumes the record, so it is not deleted here.
        router.replace(`/fitness/files?share=${encodeURIComponent(id)}`)
        return
      }

      const consumed = await takeStagedShare(id)
      if (!consumed) {
        setState({ seed: null, notice: null, unavailable: true })
        return
      }

      if (plan.kind === 'empty') {
        setState({
          seed: null,
          notice: describeSkippedFiles(plan.skipped),
          unavailable: false
        })
        return
      }

      setState({
        seed: { media: plan.media, fitnessFile: plan.fitnessFile },
        notice: describeSkippedFiles(plan.skipped),
        unavailable: false
      })
    })()
  }, [enabled, limits, router])

  return state
}
