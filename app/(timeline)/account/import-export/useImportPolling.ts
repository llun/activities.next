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

const isActive = (accountImport: AccountImportResponse | null) =>
  accountImport?.status === 'queued' || accountImport?.status === 'running'

export const useImportPolling = ({ actorId, initialImport }: Props) => {
  const [accountImport, setAccountImport] = useState(initialImport)
  const [actorChanged, setActorChanged] = useState(false)
  const isOffline = useConnectionStatus().state === 'offline'
  const requestInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!accountImport || !isActive(accountImport) || requestInFlight.current) {
      return null
    }
    requestInFlight.current = true
    try {
      const updated = await getAccountImport({ actorId, id: accountImport.id })
      setAccountImport(updated)
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
    if (!isActive(accountImport) || isOffline) return
    const interval = window.setInterval(
      () => void refresh(),
      IMPORT_POLL_INTERVAL_MS
    )
    return () => window.clearInterval(interval)
  }, [accountImport, isOffline, refresh])

  useEffect(() => {
    if (!isActive(accountImport)) return
    return onConnectionRestored(() => void refresh())
  }, [accountImport, refresh])

  return {
    accountImport,
    setAccountImport,
    actorChanged,
    refresh
  }
}
