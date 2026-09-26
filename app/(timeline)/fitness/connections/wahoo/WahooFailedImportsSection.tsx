'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type WahooFailedImport,
  getWahooFailedImports,
  retryWahooFailedImport
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'

interface Props {
  connected: boolean
  automaticImportAvailable: boolean
}

export const WahooFailedImportsSection = ({
  connected,
  automaticImportAvailable
}: Props) => {
  const [imports, setImports] = useState<WahooFailedImport[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await getWahooFailedImports(signal)
    if (!signal?.aborted) {
      setImports(
        response.imports.filter(
          (item) => item.status === 'failed' || item.status === 'unsupported'
        )
      )
    }
  }, [])

  useEffect(() => {
    if (!connected) {
      setImports([])
      return
    }

    const controller = new AbortController()
    setIsLoading(true)
    void refresh(controller.signal)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load Wahoo import errors'
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [connected, refresh])

  const retry = async (item: WahooFailedImport) => {
    setError('')
    setMessage('')
    setRetryingId(item.id)
    try {
      await retryWahooFailedImport(item.id)
      await refresh()
      setMessage(`Workout ${item.workoutId} queued for retry.`)
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : 'Failed to retry Wahoo workout'
      )
    } finally {
      setRetryingId(null)
    }
  }

  if (!connected) return null

  return (
    <section
      aria-labelledby="wahoo-failed-imports-heading"
      className="space-y-4 border-t pt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="wahoo-failed-imports-heading"
            className="text-lg font-semibold"
          >
            Workouts needing attention
          </h2>
          <p className="text-sm text-muted-foreground">
            Failed and unsupported Wahoo workouts appear here so you can retry
            them individually.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading || retryingId !== null}
          onClick={() => {
            setError('')
            setIsLoading(true)
            void refresh()
              .catch((loadError) => {
                setError(
                  loadError instanceof Error
                    ? loadError.message
                    : 'Failed to refresh Wahoo import errors'
                )
              })
              .finally(() => setIsLoading(false))
          }}
        >
          Refresh
        </Button>
      </div>

      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading workout errors…
        </p>
      )}
      {!isLoading && imports.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          No workouts need attention.
        </p>
      )}
      {imports.length > 0 && (
        <ul className="space-y-2">
          {imports.slice(0, 10).map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Workout {item.workoutId}</p>
                <p className="capitalize text-muted-foreground">
                  {item.status}
                </p>
                {item.lastError && (
                  <p className="break-words text-destructive">
                    {item.lastError}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!automaticImportAvailable || retryingId !== null}
                onClick={() => void retry(item)}
              >
                {retryingId === item.id ? 'Retrying…' : 'Retry'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {imports.length > 10 && (
        <p className="text-xs text-muted-foreground">
          Showing 10 of {imports.length} workouts. Retry or resolve them to see
          the rest.
        </p>
      )}
      {!automaticImportAvailable && imports.length > 0 && (
        <p role="alert" className="text-sm text-muted-foreground">
          Retrying workouts requires a durable background job queue on this
          server.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {message}
        </p>
      )}
    </section>
  )
}
