import { isRenderableAttachment } from '@/lib/types/domain/attachment'
import type { StatusLinkPreview, StatusNote } from '@/lib/types/domain/status'
import { isAbortError } from '@/lib/utils/isAbortError'

import { ApiRequestError } from './http'
import { getStatusIfReadable, toStatusLinkPreviewFromCard } from './statuses'

export const PENDING_LINK_PREVIEW_POLL_DELAYS_MS = [1_500, 3_000, 5_000, 8_000]

const MAX_RESOLVED_CACHE_ENTRIES = 64
const HTTP_URL_PATTERN = /https?:\/\/\S+/i
const TERMINAL_POLL_STATUS_CODES = new Set([401, 403, 410])

export type ResolvedLinkPreviewEntry = {
  linkPreview: StatusLinkPreview
  text: string
  updatedAt: number
}

type GlobalLinkPreviewListener = (
  statusId: string,
  resolved: ResolvedLinkPreviewEntry
) => void

type ActivePollEntry = {
  generation: number
  controller: AbortController
  timer: ReturnType<typeof setTimeout> | null
}

const resolvedPreviews = new Map<string, ResolvedLinkPreviewEntry>()
const activePolls = new Map<string, ActivePollEntry>()
const statusListeners = new Map<string, Set<() => void>>()
const globalListeners = new Set<GlobalLinkPreviewListener>()
let nextGeneration = 0

const notifyStatusListeners = (statusId: string) => {
  const listeners = statusListeners.get(statusId)
  if (!listeners) return
  for (const listener of [...listeners]) {
    listener()
  }
}

const notifyGlobalListeners = (
  statusId: string,
  resolved: ResolvedLinkPreviewEntry
) => {
  for (const listener of [...globalListeners]) {
    listener(statusId, resolved)
  }
}

const cacheResolvedPreview = (
  statusId: string,
  resolved: ResolvedLinkPreviewEntry
) => {
  if (resolvedPreviews.has(statusId)) {
    resolvedPreviews.delete(statusId)
  }
  while (resolvedPreviews.size >= MAX_RESOLVED_CACHE_ENTRIES) {
    const oldestKey = resolvedPreviews.keys().next().value
    if (oldestKey === undefined) break
    resolvedPreviews.delete(oldestKey)
  }
  resolvedPreviews.set(statusId, resolved)
}

const waitForDelay = (
  ms: number,
  signal: AbortSignal,
  setTimer: (timer: ReturnType<typeof setTimeout> | null) => void
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      setTimer(null)
      resolve(false)
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      timer = null
      setTimer(null)
      resolve(!signal.aborted)
    }, ms)
    setTimer(timer)
    signal.addEventListener('abort', onAbort, { once: true })
  })

/** Subscribe to resolved link-preview updates for a single status id. */
export const subscribeStatusLinkPreview = (
  statusId: string,
  listener: () => void
): (() => void) => {
  let listeners = statusListeners.get(statusId)
  if (!listeners) {
    listeners = new Set()
    statusListeners.set(statusId, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = statusListeners.get(statusId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      statusListeners.delete(statusId)
    }
  }
}

/** Return the referentially stable resolved preview entry for `statusId`, or `null`. */
export const getResolvedLinkPreviewEntry = (
  statusId: string
): ResolvedLinkPreviewEntry | null => resolvedPreviews.get(statusId) ?? null

/** Return the resolved preview card for `statusId`, or `null`. */
export const getResolvedLinkPreviewSnapshot = (
  statusId: string
): StatusLinkPreview | null =>
  resolvedPreviews.get(statusId)?.linkPreview ?? null

/** Subscribe to every resolved link preview across all statuses. */
export const subscribeAnyLinkPreviewResolved = (
  listener: GlobalLinkPreviewListener
): (() => void) => {
  globalListeners.add(listener)
  return () => {
    globalListeners.delete(listener)
  }
}

/** Cancel any active poll and drop any cached resolved preview for `statusId`. */
export const clearPendingLinkPreview = (statusId: string) => {
  const existingPoll = activePolls.get(statusId)
  if (existingPoll) {
    if (existingPoll.timer !== null) {
      clearTimeout(existingPoll.timer)
    }
    existingPoll.controller.abort()
    activePolls.delete(statusId)
  }
  if (resolvedPreviews.delete(statusId)) {
    notifyStatusListeners(statusId)
  }
}

/**
 * Reconcile background link-preview polling after a local create or edit.
 *
 * Always cancels any in-flight poll and removes any cached preview for the
 * status first so an edit that changes or deletes a link cannot resurrect the
 * pre-edit card, then starts bounded polling when the status has an eligible
 * link whose preview card is not yet present.
 */
export const syncPendingLinkPreviewForStatus = (status: StatusNote) => {
  clearPendingLinkPreview(status.id)

  if (
    status.linkPreview ||
    status.quote ||
    status.fitness ||
    status.attachments.some(isRenderableAttachment) ||
    !HTTP_URL_PATTERN.test(status.text)
  ) {
    return
  }

  const generation = ++nextGeneration
  const controller = new AbortController()
  const entry: ActivePollEntry = {
    generation,
    controller,
    timer: null
  }
  activePolls.set(status.id, entry)

  const isCurrent = () =>
    activePolls.get(status.id) === entry && !controller.signal.aborted

  void (async () => {
    try {
      for (const delayMs of PENDING_LINK_PREVIEW_POLL_DELAYS_MS) {
        const shouldContinue = await waitForDelay(
          delayMs,
          controller.signal,
          (timer) => {
            entry.timer = timer
          }
        )
        if (!shouldContinue || !isCurrent()) return

        try {
          const mastodonStatus = await getStatusIfReadable(status.id, {
            signal: controller.signal
          })
          if (!isCurrent()) return
          if (!mastodonStatus) return

          // Stop if the status was edited elsewhere (different text or newer revision).
          if (
            typeof mastodonStatus.text === 'string' &&
            mastodonStatus.text !== status.text
          ) {
            return
          }
          const serverUpdatedAt = mastodonStatus.edited_at
            ? Date.parse(mastodonStatus.edited_at)
            : Number.NaN
          if (
            Number.isFinite(serverUpdatedAt) &&
            serverUpdatedAt > status.updatedAt
          ) {
            return
          }

          const resolvedCard = toStatusLinkPreviewFromCard(mastodonStatus.card)
          if (resolvedCard) {
            const resolvedEntry: ResolvedLinkPreviewEntry = {
              linkPreview: resolvedCard,
              text: status.text,
              updatedAt: status.updatedAt
            }
            cacheResolvedPreview(status.id, resolvedEntry)
            notifyStatusListeners(status.id)
            notifyGlobalListeners(status.id, resolvedEntry)
            return
          }
        } catch (error) {
          if (isAbortError(error) || !isCurrent()) return
          if (
            error instanceof ApiRequestError &&
            TERMINAL_POLL_STATUS_CODES.has(error.status)
          ) {
            return
          }
        }
      }
    } finally {
      if (activePolls.get(status.id) === entry) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer)
        }
        activePolls.delete(status.id)
      }
    }
  })()
}

export const resetPendingLinkPreviewsForTesting = () => {
  for (const entry of activePolls.values()) {
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
    }
    entry.controller.abort()
  }
  activePolls.clear()
  resolvedPreviews.clear()
  statusListeners.clear()
  globalListeners.clear()
  nextGeneration = 0
}
