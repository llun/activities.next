'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  AccountImportResponse,
  getAccountImport
} from '@/lib/client/accountImports'
import { onConnectionRestored } from '@/lib/client/connection'
import { ApiRequestError } from '@/lib/client/http'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'

export const IMPORT_POLL_INTERVAL_MS = 3_000

interface Props {
  actorId: string
  initialImport: AccountImportResponse | null
}

// Only an import the server is moving on its own is worth polling. A queued
// row that was never started is an upload waiting for its start: nothing but
// Start, Discard or the 24 h sweep can change it, so polling it would only
// risk a stale answer overwriting the user's next action.
const isActive = (accountImport: AccountImportResponse | null) =>
  accountImport !== null &&
  (accountImport.status === 'running' ||
    (accountImport.status === 'queued' && accountImport.startedAt !== null))

export const useImportPolling = ({ actorId, initialImport }: Props) => {
  const [accountImport, setAccountImportState] = useState(initialImport)
  const [actorChanged, setActorChanged] = useState(false)
  const isOffline = useConnectionStatus().state === 'offline'
  const requestInFlight = useRef(false)
  // Bumped every time the state is set from outside a poll. A poll answer
  // that comes back after that carries state older than what the page already
  // shows, so it is dropped instead of overwriting the newer state.
  const generationRef = useRef(0)

  const setAccountImport = useCallback((next: AccountImportResponse | null) => {
    generationRef.current += 1
    setAccountImportState(next)
  }, [])

  const refresh = useCallback(async () => {
    if (!accountImport || !isActive(accountImport) || requestInFlight.current) {
      return null
    }
    requestInFlight.current = true
    const generation = generationRef.current
    try {
      const updated = await getAccountImport({ actorId, id: accountImport.id })
      if (generationRef.current === generation) setAccountImportState(updated)
      return updated
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setActorChanged(true)
      }
      return null
    } finally {
      requestInFlight.current = false
    }
  }, [accountImport, actorId])

  useEffect(() => {
    if (!isActive(accountImport) || isOffline || actorChanged) return
    const interval = window.setInterval(
      () => void refresh(),
      IMPORT_POLL_INTERVAL_MS
    )
    return () => window.clearInterval(interval)
  }, [accountImport, actorChanged, isOffline, refresh])

  useEffect(() => {
    if (!isActive(accountImport) || actorChanged) return
    return onConnectionRestored(() => void refresh())
  }, [accountImport, actorChanged, refresh])

  return {
    accountImport,
    setAccountImport,
    actorChanged,
    refresh
  }
}
