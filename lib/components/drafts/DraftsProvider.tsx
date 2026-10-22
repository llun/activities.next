'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  getConnectionSnapshot,
  onConnectionRestored,
  reportRequestFailure
} from '@/lib/client/connection'
import {
  announceDraftsChanged,
  postDraftsMessage,
  subscribeDraftsMessages
} from '@/lib/client/drafts/draftsChannel'
import type {
  DraftQueueState,
  SendQueueProgress
} from '@/lib/client/drafts/types'
import { NotSavedToDraftsNote } from '@/lib/components/drafts/NotSavedToDraftsNote'

// The IndexedDB code and the Saved note load after mount, so neither is part
// of any page's first-load JavaScript.
type DraftsModule = typeof import('@/lib/client/drafts')

// Loaded once and shared; a failed load is forgotten so the next call retries.
const once = <T,>(load: () => Promise<T>) => {
  let loaded: Promise<T> | null = null
  return () =>
    (loaded ??= load().catch((error: unknown) => {
      loaded = null
      throw error
    }))
}
const loadDrafts = once(() => import('@/lib/client/drafts'))

/** How long a finished drain's "N posts sent" stays in the status slot. */
export const RESULT_VISIBLE_MS = 15_000

// The send queue's real dependencies, from sub-paths (never the
// `@/lib/client` barrel), loaded only when a drain actually runs.
const loadQueueApis = once(() =>
  Promise.all([
    import('@/lib/client/statuses'),
    import('@/lib/client/media'),
    import('@/lib/client/fitnessImports'),
    import('@/lib/client/fitnessRoutes'),
    import('@/lib/client/gallery')
  ])
)

const loadSendQueueDeps = async (
  m: DraftsModule,
  accountId: string,
  actorId: string
) => {
  const [statuses, media, fitnessImports, fitnessRoutes, gallery] =
    await loadQueueApis()
  return {
    listDrafts: m.listDrafts,
    claimQueuedDraft: m.claimQueuedDraft,
    updateQueuedDraft: m.updateQueuedDraft,
    renewClaim: m.renewClaim,
    deleteDraftIfRevision: m.deleteDraftIfRevision,
    getDraftBlob: m.getDraftBlob,
    createNote: statuses.createNote,
    createPoll: statuses.createPoll,
    getStatusIfReadable: statuses.getStatusIfReadable,
    getGallerySettings: gallery.getGallerySettings,
    uploadAttachment: media.uploadAttachment,
    uploadFitnessFile: fitnessImports.uploadFitnessFile,
    deleteUnpostedMedia: media.deleteUnpostedMedia,
    deleteUnpostedFitnessFile: fitnessRoutes.deleteUnpostedFitnessFile,
    isOnline: () => getConnectionSnapshot().state === 'online',
    reportRequestFailure,
    announce: (draftId: string) =>
      announceDraftsChanged(accountId, actorId, draftId),
    now: () => Date.now()
  }
}

/**
 * When a queued item next needs the sender: its backoff ends, or a dead tab's
 * lease runs out. Items that wait for the user (needs review, paused by them)
 * never wake it.
 */
const wakeTimeOf = (queue: DraftQueueState): number | null => {
  if (queue.state === 'sending') return queue.claim?.until ?? null
  const retriesOnItsOwn =
    queue.state === 'waiting' ||
    queue.state === 'checking' ||
    (queue.state === 'paused' && queue.pausedBy === 'rate_limit')
  return retriesOnItsOwn ? (queue.nextAttemptAt ?? null) : null
}

const SavedToDraftsNote = dynamic(
  () =>
    import('@/lib/components/drafts/SavedToDraftsNote').then(
      (module) => module.SavedToDraftsNote
    ),
  { ssr: false }
)

export interface DraftsContextValue {
  accountId: string
  actorId: string
  /** The account's sign-out epoch; null until it has been read. */
  epoch: number | null
  /** Drafts saved on this device for the current actor. */
  count: number
  /** Another tab is signing this account out: composers stop saving. */
  signingOut: boolean
  /**
   * Asks for the "Saved to Drafts" note for the revision that was kept;
   * `queued` is a post waiting to send when back online.
   */
  notifySavedToDrafts: (
    draftId: string,
    revision: number,
    options?: { queued?: boolean }
  ) => void
  /** Asks the send queue to run now (stable). */
  requestDrain: () => void
  /** A closed composer's draft could not be kept: the note offers its text. */
  notifyNotSavedToDrafts: (text: string) => void
}

const DraftsContext = createContext<DraftsContextValue | null>(null)

// Progress lives in its own context so a "Sending 2 of 5" tick never
// re-renders every `useDrafts()` consumer.
export type SendQueueStatus = SendQueueProgress & { pause: () => Promise<void> }

const SendQueueContext = createContext<SendQueueStatus | null>(null)

/** `null` outside the provider. */
export const useSendQueueStatus = (): SendQueueStatus | null =>
  useContext(SendQueueContext)

const IDLE_PROGRESS: SendQueueProgress = {
  phase: 'idle',
  index: 0,
  total: 0,
  sent: 0,
  needsReview: 0,
  failed: 0,
  paused: 0
}

/** `null` outside the provider, so every consumer works unprovided. */
export const useDrafts = (): DraftsContextValue | null =>
  useContext(DraftsContext)

interface DraftsProviderProps {
  accountId: string
  actorId: string
  children: ReactNode
}

export function DraftsProvider({
  accountId,
  actorId,
  children
}: DraftsProviderProps) {
  const [epoch, setEpoch] = useState<number | null>(null)
  const [count, setCount] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const [saved, setSaved] = useState<{
    id: string
    revision: number
    queued: boolean
  } | null>(null)
  // The text of a closed composer whose draft could not be kept.
  const [unsavedText, setUnsavedText] = useState<string | null>(null)
  const dismissNote = useCallback(() => setSaved(null), [])
  const dismissUnsaved = useCallback(() => setUnsavedText(null), [])
  // The unsaved note holds text kept nowhere else: only Dismiss clears it, a
  // second failure adds its text, and a Saved note waits until it is gone.
  const notifySavedToDrafts = useCallback(
    (id: string, revision: number, options?: { queued?: boolean }) =>
      setSaved({ id, revision, queued: options?.queued === true }),
    []
  )
  const drainRef = useRef<() => void>(() => {})
  const requestDrain = useCallback(() => drainRef.current(), [])
  const notifyNotSavedToDrafts = useCallback(
    (text: string) =>
      setUnsavedText((prev) =>
        prev === null ? text : [prev, text].filter(Boolean).join('\n\n')
      ),
    []
  )
  const refreshToken = useRef(0)
  const epochToken = useRef(0)
  const epochRef = useRef<number | null>(null)
  const purgingRef = useRef(false)
  const signingOutRef = useRef(false)
  const [progress, setProgress] = useState<SendQueueProgress>(IDLE_PROGRESS)
  const pathname = usePathname()
  const drainingRef = useRef(false)
  const rerunRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // Bumped when the account or actor changes, so a drain that was started for
  // the old one hands the next pass to the current one.
  const generationRef = useRef(0)
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeToken = useRef(0)

  const refreshCount = useCallback(() => {
    const token = ++refreshToken.current
    loadDrafts()
      .then((m) => m.countDrafts({ actorId }))
      .then((next) => {
        if (token === refreshToken.current) setCount(next)
      })
      // Unavailable storage means there is nothing to count.
      .catch(() => {
        if (token === refreshToken.current) setCount(0)
      })
  }, [actorId])

  const loadEpoch = useCallback(() => {
    const token = ++epochToken.current
    loadDrafts()
      .then((m) => m.getAccountEpoch(accountId))
      .then((value) => {
        if (token !== epochToken.current) return
        epochRef.current = value
        setEpoch(value)
      })
      // Unavailable storage: stay null; `retryEpoch` tries again on recovery.
      .catch(() => {})
  }, [accountId])

  // Only an epoch that never resolved is re-read. One that is established is
  // never replaced: a sign-out bumps it, and a stale tab must keep the old
  // value so its saves are refused.
  const retryEpoch = useCallback(() => {
    if (epochRef.current === null && !purgingRef.current) loadEpoch()
  }, [loadEpoch])

  useEffect(() => {
    epochRef.current = null
    signingOutRef.current = false
    setEpoch(null)
    setSigningOut(false)
    setProgress(IDLE_PROGRESS)
    setSaved(null)
    setUnsavedText(null)
    // A sign-out whose deletion failed is finished first: it bumps the epoch
    // and removes this account's drafts, so the epoch is read only afterwards.
    let cancelled = false
    purgingRef.current = true
    void loadDrafts()
      .then((m) => m.runPendingPurges())
      // A chunk that failed to load is the same as unavailable storage.
      .catch(() => {})
      .finally(() => {
        purgingRef.current = false
        if (cancelled) return
        loadEpoch()
        refreshCount()
      })
    return () => {
      cancelled = true
      epochToken.current += 1
      refreshToken.current += 1
    }
  }, [accountId, loadEpoch, refreshCount])

  const clearWake = useCallback(() => {
    wakeToken.current += 1
    if (wakeTimerRef.current !== null) clearTimeout(wakeTimerRef.current)
    wakeTimerRef.current = null
  }, [])

  // One timer, for the earliest moment a queued item becomes sendable again:
  // the backoff of a retry, or the end of a lease a closed tab left behind.
  const scheduleWake = useCallback(() => {
    clearWake()
    const token = wakeToken.current
    loadDrafts()
      .then((m) => m.listDrafts({ actorId }))
      .then((drafts) => {
        if (token !== wakeToken.current) return
        const now = Date.now()
        // Only the future: a time already past belongs to a drain that ran
        // (or to the tab that holds the sender lock).
        const upcoming = drafts
          .map((draft) => (draft.queue ? wakeTimeOf(draft.queue) : null))
          .filter((at): at is number => at !== null && at > now)
        if (upcoming.length === 0) return
        wakeTimerRef.current = setTimeout(
          () => {
            wakeTimerRef.current = null
            drainRef.current()
          },
          Math.min(...upcoming) - now
        )
      })
      // Unavailable storage: the next trigger schedules again.
      .catch(() => {})
  }, [actorId, clearWake])

  const canDrain = useCallback(
    () =>
      epochRef.current !== null &&
      !signingOutRef.current &&
      getConnectionSnapshot().state === 'online',
    []
  )

  const drain = useCallback(() => {
    // A trigger during a drain asks for one more pass when it ends.
    if (drainingRef.current) {
      rerunRef.current = true
      return
    }
    if (!canDrain()) {
      scheduleWake()
      return
    }
    drainingRef.current = true
    const generation = generationRef.current

    const runPass = async () => {
      const controller = new AbortController()
      abortRef.current = controller
      const last: { phase: SendQueueProgress['phase'] } = { phase: 'idle' }
      try {
        const m = await loadDrafts()
        const deps = await loadSendQueueDeps(m, accountId, actorId)
        const epoch = epochRef.current
        if (epoch === null) return
        await m.withSenderLock(async () => {
          await m.drainQueue({
            accountId,
            actorId,
            epoch,
            tabId: m.TAB_ID,
            signal: controller.signal,
            deps,
            onProgress: (next) => {
              last.phase = next.phase
              postDraftsMessage({
                type: 'queue-progress',
                accountId,
                actorId,
                progress: next
              })
            }
          })
        })
      } catch {
        // Storage or a chunk failed to load: the next trigger tries again.
      } finally {
        abortRef.current = null
        // An aborted or failed drain wrote no result: don't leave other tabs
        // showing "Sending".
        if (last.phase === 'sending') {
          postDraftsMessage({
            type: 'queue-progress',
            accountId,
            actorId,
            progress: IDLE_PROGRESS
          })
        }
      }
    }

    void (async () => {
      try {
        do {
          rerunRef.current = false
          if (generationRef.current !== generation || !canDrain()) break
          await runPass()
        } while (rerunRef.current)
      } finally {
        drainingRef.current = false
        if (generationRef.current !== generation) drainRef.current()
        else scheduleWake()
      }
    })()
  }, [accountId, actorId, canDrain, scheduleWake])

  useEffect(() => {
    drainRef.current = drain
  }, [drain])

  // A drain or timer for the previous account or actor stops with it.
  useEffect(
    () => () => {
      generationRef.current += 1
      abortRef.current?.abort()
      clearWake()
    },
    [accountId, actorId, clearWake]
  )

  // A new page load is the only point where the session or actor can have
  // changed, so only now are those two pauses lifted. If they still mismatch,
  // the item pauses again, once per load.
  useEffect(() => {
    if (epoch === null) return
    let cancelled = false
    void loadDrafts()
      .then((m) => m.resumeQueue({ actorId, pausedBy: ['auth', 'actor'] }))
      .then((resumed) => {
        if (resumed > 0) announceDraftsChanged(accountId, actorId, '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) drainRef.current()
      })
    return () => {
      cancelled = true
    }
  }, [epoch, accountId, actorId])

  useEffect(() => onConnectionRestored(() => drainRef.current()), [])

  // The result is also on the Drafts page, so it may go away on its own.
  useEffect(() => {
    if (progress.phase !== 'result') return
    const id = setTimeout(() => setProgress(IDLE_PROGRESS), RESULT_VISIBLE_MS)
    return () => clearTimeout(id)
  }, [progress])

  useEffect(() => {
    setProgress((prev) => (prev.phase === 'result' ? IDLE_PROGRESS : prev))
  }, [pathname])

  useEffect(
    () =>
      subscribeDraftsMessages((message) => {
        if (message.accountId !== accountId) return
        retryEpoch()
        switch (message.type) {
          case 'changed':
            refreshCount()
            if (message.actorId === actorId) scheduleWake()
            break
          case 'signing-out':
            signingOutRef.current = true
            abortRef.current?.abort()
            setSigningOut(true)
            break
          case 'sign-out-cancelled':
            signingOutRef.current = false
            setSigningOut(false)
            drainRef.current()
            break
          case 'queue-progress':
            if (message.actorId === actorId) setProgress(message.progress)
            break
        }
      }),
    [accountId, actorId, refreshCount, retryEpoch, scheduleWake]
  )

  // Without BroadcastChannel, other tabs are only noticed on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        retryEpoch()
        refreshCount()
        drainRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshCount, retryEpoch])

  const value = useMemo<DraftsContextValue | null>(
    () =>
      accountId
        ? {
            accountId,
            actorId,
            epoch,
            count,
            signingOut,
            notifySavedToDrafts,
            requestDrain,
            notifyNotSavedToDrafts
          }
        : null,
    [
      accountId,
      actorId,
      epoch,
      count,
      signingOut,
      notifySavedToDrafts,
      requestDrain,
      notifyNotSavedToDrafts
    ]
  )

  // Pausing never recalls a request already in flight.
  const pause = useCallback(async () => {
    const { pauseQueue } = await loadDrafts()
    await pauseQueue({ actorId })
    announceDraftsChanged(accountId, actorId, '')
  }, [accountId, actorId])
  const queueStatus = useMemo<SendQueueStatus>(
    () => ({ ...progress, pause }),
    [progress, pause]
  )

  return (
    <DraftsContext.Provider value={value}>
      <SendQueueContext.Provider value={queueStatus}>
        {children}
      </SendQueueContext.Provider>
      {value && saved && unsavedText === null ? (
        <SavedToDraftsNote
          draftId={saved.id}
          revision={saved.revision}
          accountId={accountId}
          actorId={actorId}
          queued={saved.queued}
          onDismiss={dismissNote}
        />
      ) : null}
      {value && unsavedText !== null ? (
        <NotSavedToDraftsNote text={unsavedText} onDismiss={dismissUnsaved} />
      ) : null}
    </DraftsContext.Provider>
  )
}
