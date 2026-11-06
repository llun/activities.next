'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  type ShareTargetLimits,
  classifySharedFiles,
  describeSharedFiles,
  describeSkippedFiles,
  isSharedLink,
  joinSharedText
} from './classify'
import {
  deleteStagedShare,
  peekStagedShare,
  takeStagedShare,
  toShareFiles
} from './shareTargetDb'

export const SHARE_PARAM = 'share'
export const SHARE_UNAVAILABLE_PARAM = 'shareUnavailable'

export interface ShareTargetSeed {
  media: File[]
  fitnessFile?: File
  /** The shared title, text and link, joined (`joinSharedText`). */
  text?: string
}

/** A share waiting for the reader to add it to the post or discard it. */
export interface ShareTargetPending {
  id: string
  media: File[]
  fitnessFile?: File
  /** The shared title, text and link, joined; empty when none was shared. */
  text: string
  /** "2 photos and 1 workout were shared", "A link was shared". */
  summary: string
}

export interface ShareTargetIntakeState {
  /** Files to hand to the composer, once the reader pressed Add to post. */
  seed: ShareTargetSeed | null
  /** Files shown for confirmation; nothing is uploaded until accepted. */
  pending: ShareTargetPending | null
  /** A one-off note about files that were skipped. */
  notice: string | null
  /** The share arrived before the worker could stage it (`?shareUnavailable`). */
  unavailable: boolean
  /** The staged share is gone: past its 24 h, evicted, or used elsewhere. */
  expired: boolean
}

export interface ShareTargetIntake extends ShareTargetIntakeState {
  /** Consumes the staged share and hands its files to the composer. */
  accept: () => Promise<void>
  /** Deletes the staged share without using it. */
  discard: () => Promise<void>
}

const readParams = () =>
  typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search)

// Removes the one-time share parameters, as the `?media=` seeding does, so a
// reload does not try to use the same share again.
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

const IDLE: ShareTargetIntakeState = {
  seed: null,
  pending: null,
  notice: null,
  unavailable: false,
  expired: false
}

/**
 * Reads the staged share named by `?share=<id>`. Any page can submit a share
 * to this origin, so a share is never used on arrival: media and a single
 * workout come back as `pending`, for the reader to confirm (`accept`, which
 * consumes the record and returns the composer seed) or `discard`. Until then
 * the record and the query parameter stay, so a reload asks again (within the
 * 24 h expiry). Shared text and links come too, and on accept they seed the
 * composer's text with the files. Two or more workouts hand the record to
 * `/fitness/files` (which has no text field), which
 * preselects them and uploads nothing until Import is pressed.
 */
export function useShareTargetIntake({
  enabled,
  limits
}: {
  enabled: boolean
  limits: ShareTargetLimits
}): ShareTargetIntake {
  const router = useRouter()
  const [state, setState] = useState<ShareTargetIntakeState>(IDLE)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || startedRef.current) return
    const params = readParams()
    const unavailable = params.has(SHARE_UNAVAILABLE_PARAM)
    const id = params.get(SHARE_PARAM)
    if (!unavailable && !id) return

    startedRef.current = true

    if (unavailable || !id) {
      stripShareParams()
      setState({ ...IDLE, unavailable: true })
      return
    }

    void (async () => {
      const share = await peekStagedShare(id)
      if (!share) {
        stripShareParams()
        setState({ ...IDLE, expired: true })
        return
      }

      const plan = classifySharedFiles(
        toShareFiles(share),
        limits,
        share.skipped ?? 0
      )
      const text = joinSharedText(share)
      // A link with only its page title (no body text) is still a link share.
      const isLink =
        Boolean(share.url?.trim()) && !share.text?.trim()
          ? true
          : isSharedLink(text)
      if (plan.kind === 'import') {
        // The import page reads the record, so it is not deleted here.
        stripShareParams()
        router.replace(`/fitness/files?share=${encodeURIComponent(id)}`)
        return
      }

      if (plan.kind === 'empty' && !text) {
        // Nothing to confirm: the record has no use left.
        await deleteStagedShare(id)
        stripShareParams()
        setState({ ...IDLE, notice: describeSkippedFiles(plan.skipped) })
        return
      }

      setState({
        ...IDLE,
        pending: {
          id,
          media: plan.kind === 'composer' ? plan.media : [],
          fitnessFile: plan.kind === 'composer' ? plan.fitnessFile : undefined,
          text,
          summary:
            plan.kind === 'composer'
              ? describeSharedFiles(plan.media, plan.fitnessFile, text, isLink)
              : describeSharedFiles([], undefined, text, isLink)
        },
        notice: describeSkippedFiles(plan.skipped)
      })
    })()
  }, [enabled, limits, router])

  const accept = async () => {
    const pending = state.pending
    if (!pending) return
    const consumed = await takeStagedShare(pending.id)
    stripShareParams()
    if (!consumed) {
      setState({ ...IDLE, expired: true })
      return
    }
    setState({
      ...IDLE,
      seed: {
        media: pending.media,
        fitnessFile: pending.fitnessFile,
        text: pending.text || undefined
      }
    })
  }

  const discard = async () => {
    const pending = state.pending
    if (!pending) return
    await deleteStagedShare(pending.id)
    stripShareParams()
    setState(IDLE)
  }

  return { ...state, accept, discard }
}
