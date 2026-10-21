'use client'

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
  countDrafts,
  getAccountEpoch,
  runPendingPurges,
  subscribeDraftsMessages
} from '@/lib/client/drafts'
import { SavedToDraftsNote } from '@/lib/components/drafts/SavedToDraftsNote'

export interface DraftsContextValue {
  accountId: string
  actorId: string
  /** The account's sign-out epoch; null until it has been read. */
  epoch: number | null
  /** Drafts saved on this device for the current actor. */
  count: number
  /** Another tab is signing this account out: composers stop saving. */
  signingOut: boolean
  /** The draft the "Saved to Drafts" note is showing for, if any. */
  savedDraftId: string | null
  /** Asks for the "Saved to Drafts" note for a draft that was just kept. */
  notifySavedToDrafts: (draftId: string) => void
}

const DraftsContext = createContext<DraftsContextValue | null>(null)

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
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)
  const dismissNote = useCallback(() => setSavedDraftId(null), [])
  const refreshToken = useRef(0)
  const epochToken = useRef(0)
  const epochRef = useRef<number | null>(null)
  const purgingRef = useRef(false)

  const refreshCount = useCallback(() => {
    const token = ++refreshToken.current
    countDrafts({ actorId })
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
    getAccountEpoch(accountId)
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
    setEpoch(null)
    setSigningOut(false)
    setSavedDraftId(null)
    // A sign-out whose deletion failed is finished first: it bumps the epoch
    // and removes this account's drafts, so the epoch is read only afterwards.
    let cancelled = false
    purgingRef.current = true
    void runPendingPurges().finally(() => {
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

  useEffect(
    () =>
      subscribeDraftsMessages((message) => {
        if (message.accountId !== accountId) return
        retryEpoch()
        if (message.type === 'changed') refreshCount()
        else if (message.type === 'signing-out') setSigningOut(true)
        else setSigningOut(false)
      }),
    [accountId, refreshCount, retryEpoch]
  )

  // Without BroadcastChannel, other tabs are only noticed on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        retryEpoch()
        refreshCount()
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
            savedDraftId,
            notifySavedToDrafts: setSavedDraftId
          }
        : null,
    [accountId, actorId, epoch, count, signingOut, savedDraftId]
  )

  return (
    <DraftsContext.Provider value={value}>
      {children}
      {value && savedDraftId ? (
        <SavedToDraftsNote
          draftId={savedDraftId}
          accountId={accountId}
          actorId={actorId}
          onDismiss={dismissNote}
        />
      ) : null}
    </DraftsContext.Provider>
  )
}
