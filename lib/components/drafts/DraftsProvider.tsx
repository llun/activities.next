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
import {
  CLAIM_LEASE_MS,
  holdsQueue,
  retriesOnItsOwn
} from '@/lib/client/drafts/queueConstants'
import type {
  DraftQueueState,
  DraftRecord,
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

/**
 * The next try for an item that is already due, or for a pass another tab's
 * sender lock turned away: soon, but never a tight loop while that tab drains.
 */
export const RETRY_SOON_MS = 2_000

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
 * When a queued item next needs the sender: now for a fresh one (the tab that
 * queued it may be unable to drain), when its backoff ends, or when a dead
 * tab's lease runs out. Items that wait for the user (needs review, paused by
 * them) never wake it.
 */
const wakeTimeOf = (queue: DraftQueueState): number | null => {
  if (queue.state === 'sending') return queue.claim?.until ?? null
  return retriesOnItsOwn(queue) ? (queue.nextAttemptAt ?? 0) : null
}

/** A queued item as one pass saw it: any later write makes it a new one. */
const itemKey = (draft: DraftRecord): string => `${draft.id}@${draft.revision}`

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
export type SendQueueStatus = SendQueueProgress & {
  /** Never rejects: a failure sets `pauseFailed`. */
  pause: () => Promise<void>
  /** The last Pause failed, so the queue is still sending. */
  pauseFailed: boolean
  /** This tab's last drain failed before it could finish (storage, a chunk). */
  drainFailed: boolean
  /** Runs the queue again now. */
  retry: () => void
}

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
  const [pauseFailed, setPauseFailed] = useState(false)
  const [drainFailed, setDrainFailed] = useState(false)
  const pathname = usePathname()
  const drainingRef = useRef(false)
  const rerunRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // Bumped when the account or actor changes, so a drain that was started for
  // the old one hands the next pass to the current one.
  const generationRef = useRef(0)
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeToken = useRef(0)
  // The items (by id and revision) the last pass found due and could not
  // move: it failed, or claimed none of them. A new or changed item is not
  // one of them.
  const stalledRef = useRef<ReadonlySet<string>>(new Set())

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
    setDrainFailed(false)
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

  const canDrain = useCallback(
    () =>
      epochRef.current !== null &&
      !signingOutRef.current &&
      getConnectionSnapshot().state === 'online',
    []
  )

  // One timer, for the earliest moment a queued item becomes sendable again:
  // the backoff of a retry, or the end of a lease a closed tab left behind.
  // An item already due (fresh, past its time, or turned away by another
  // tab's sender lock) is tried RETRY_SOON_MS from now, unless the last pass
  // found it due and moved nothing, or a 401 or profile switch holds the
  // queue: repeating those would only spin, so they wait for the next trigger
  // or a change to the item. "Already" is before the read, so an item falling
  // due during it still gets its own time. While this tab cannot drain, only
  // the future counts: coming back online, an epoch or a cancelled sign-out
  // drains on its own.
  const scheduleWake = useCallback(() => {
    clearWake()
    const token = wakeToken.current
    const now = Date.now()
    loadDrafts()
      .then((m) => m.listDrafts({ actorId }))
      .then((drafts) => {
        if (token !== wakeToken.current) return
        const queued = drafts.filter(
          (draft) => draft.accountId === accountId && draft.queue
        )
        const soon =
          canDrain() && !queued.some((draft) => holdsQueue(draft.queue))
            ? now + RETRY_SOON_MS
            : null
        const upcoming = queued
          .map((draft) => {
            const at = draft.queue ? wakeTimeOf(draft.queue) : null
            if (at === null || at > now) return at
            return stalledRef.current.has(itemKey(draft)) ? null : soon
          })
          .filter((at): at is number => at !== null)
        if (upcoming.length === 0) return
        wakeTimerRef.current = setTimeout(
          () => {
            wakeTimerRef.current = null
            drainRef.current()
          },
          Math.min(...upcoming) - Date.now()
        )
      })
      // Unavailable storage: the next trigger schedules again.
      .catch(() => {})
  }, [accountId, actorId, canDrain, clearWake])

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
      let due: string[] = []
      try {
        const m = await loadDrafts()
        const epoch = epochRef.current
        if (epoch === null) return
        // Most triggers find nothing due: skip the sender's code and the lock.
        const startedAt = Date.now()
        const drafts = (await m.listDrafts({ actorId })).filter(
          (draft) => draft.accountId === accountId
        )
        // A 401 or profile switch holds the whole queue until the next load
        // lifts it (above), so no pass, rerun or trigger posts into it.
        due = drafts.some((draft) => holdsQueue(draft.queue))
          ? []
          : drafts
              .filter((draft) => m.isQueueClaimable(draft.queue, startedAt))
              .map(itemKey)
        if (due.length === 0) {
          stalledRef.current = new Set()
          if (!controller.signal.aborted) setDrainFailed(false)
          return
        }
        const deps = await loadSendQueueDeps(m, accountId, actorId)
        let attempted = 0
        const ran = await m.withSenderLock(async () => {
          const result = await m.drainQueue({
            accountId,
            actorId,
            epoch,
            tabId: m.TAB_ID,
            signal: controller.signal,
            deps,
            onProgress: (next) => {
              // A drain that claimed nothing is silent: no one needs an idle.
              if (next.phase === 'idle' && last.phase === 'idle') return
              last.phase = next.phase
              postDraftsMessage({
                type: 'queue-progress',
                accountId,
                actorId,
                progress: next
              })
            }
          })
          attempted = result.attempted
        })
        // A lock miss is no stall: another tab is draining, and an item it
        // listed too late is still due here, so it is tried again soon.
        stalledRef.current = new Set(ran && attempted === 0 ? due : [])
        if (!controller.signal.aborted) setDrainFailed(false)
      } catch {
        // Storage or a chunk failed to load: the next trigger tries again,
        // and the Drafts page offers Retry meanwhile.
        stalledRef.current = new Set(due)
        if (!controller.signal.aborted) setDrainFailed(true)
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

  // A sender that closed mid-drain never says it stopped. Its lease is the
  // longest it can hold an item, so after one lease without an update the
  // progress is stale: show idle and drain, which reclaims the expired lease.
  // A drain running in this tab renews its own lease, so it keeps its progress.
  useEffect(() => {
    if (progress.phase !== 'sending') return
    const id = setTimeout(() => {
      if (drainingRef.current) return
      setProgress(IDLE_PROGRESS)
      drainRef.current()
    }, CLAIM_LEASE_MS)
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
            if (message.actorId !== actorId) break
            // Every autosave says `changed`: only a queued draft (or a bulk
            // change, with no id) can move the wake time.
            if (!message.draftId) scheduleWake()
            else {
              void loadDrafts()
                .then((m) => m.getDraft(message.draftId))
                .then((draft) => {
                  if (draft?.queue) scheduleWake()
                })
                .catch(() => {})
            }
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
    try {
      const { pauseQueue } = await loadDrafts()
      await pauseQueue({ actorId })
      setPauseFailed(false)
      announceDraftsChanged(accountId, actorId, '')
    } catch {
      setPauseFailed(true)
    }
  }, [accountId, actorId])
  // A failed Pause only matters while that send is still going.
  useEffect(() => {
    if (progress.phase !== 'sending') setPauseFailed(false)
  }, [progress.phase])
  const queueStatus = useMemo<SendQueueStatus>(
    () => ({
      ...progress,
      pause,
      pauseFailed,
      drainFailed,
      retry: requestDrain
    }),
    [progress, pause, pauseFailed, drainFailed, requestDrain]
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
