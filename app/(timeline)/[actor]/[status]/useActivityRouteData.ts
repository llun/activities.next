'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type FitnessRouteDataResponse,
  getFitnessRouteData
} from '@/lib/client'

export const ROUTE_DATA_ERROR_MESSAGE =
  'Could not load route and analysis data for this activity.'

export interface ActivityRouteData {
  /** The payload for `fitnessFileId`, or null until it has loaded. */
  data: FitnessRouteDataResponse | null
  isLoading: boolean
  error: string | null
  retry: () => void
}

/**
 * Route data for the recording on screen. Every section of the activity page
 * reads it (the map, the charts, the tables), so it loads as soon as there is
 * a recording, and again whenever another recording is picked. A response that
 * lands after the reader has moved to another recording is dropped.
 */
export const useActivityRouteData = (
  fitnessFileId: string | null | undefined
): ActivityRouteData => {
  const [state, setState] = useState<{
    fileId: string | null
    data: FitnessRouteDataResponse | null
    error: string | null
  }>({ fileId: null, data: null, error: null })
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState({ fileId: null, data: null, error: null })
    setAttempt((prev) => prev + 1)
  }, [])

  useEffect(() => {
    if (!fitnessFileId) return
    let cancelled = false

    const load = async () => {
      try {
        const data = await getFitnessRouteData(fitnessFileId)
        if (cancelled) return
        setState({ fileId: fitnessFileId, data, error: null })
      } catch {
        if (cancelled) return
        setState({
          fileId: fitnessFileId,
          data: null,
          error: ROUTE_DATA_ERROR_MESSAGE
        })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [fitnessFileId, attempt])

  const isCurrent = Boolean(fitnessFileId) && state.fileId === fitnessFileId
  return {
    data: isCurrent ? state.data : null,
    isLoading: Boolean(fitnessFileId) && !isCurrent,
    error: isCurrent ? state.error : null,
    retry
  }
}
