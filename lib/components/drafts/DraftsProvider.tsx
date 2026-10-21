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
  subscribeDraftsMessages
} from '@/lib/client/drafts'

export interface DraftsContextValue {
  accountId: string
  actorId: string
  /** The account's sign-out epoch; null until it has been read. */
  epoch: number | null
  /** Drafts saved on this device for the current actor. */
  count: number
  /** Another tab is signing this account out: composers stop saving. */
  signingOut: boolean
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
  // The draft the "Saved to Drafts" note is for. The note itself is not
  // rendered yet; `SavedToDraftsNote` will read this.
  const [, setSavedDraftId] = useState<string | null>(null)
  const refreshToken = useRef(0)

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

  useEffect(() => {
    let cancelled = false
    setEpoch(null)
    setSigningOut(false)
    getAccountEpoch(accountId)
      .then((value) => {
        if (!cancelled) setEpoch(value)
      })
      .catch(() => {
        if (!cancelled) setEpoch(null)
      })
    refreshCount()
    return () => {
      cancelled = true
      refreshToken.current += 1
    }
  }, [accountId, refreshCount])

  useEffect(
    () =>
      subscribeDraftsMessages((message) => {
        if (message.accountId !== accountId) return
        if (message.type === 'changed') refreshCount()
        else if (message.type === 'signing-out') setSigningOut(true)
        else setSigningOut(false)
      }),
    [accountId, refreshCount]
  )

  // Without BroadcastChannel, other tabs are only noticed on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshCount()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshCount])

  const value = useMemo<DraftsContextValue | null>(
    () =>
      accountId
        ? {
            accountId,
            actorId,
            epoch,
            count,
            signingOut,
            notifySavedToDrafts: setSavedDraftId
          }
        : null,
    [accountId, actorId, epoch, count, signingOut]
  )

  return (
    <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
  )
}
