'use client'

import { CheckCircle2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  type WahooFailedImport,
  getWahooFailedImports,
  retryWahooFailedImport
} from '@/lib/client'
import { RefreshButton } from '@/lib/components/refresh-button'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
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
    <Section
      title="Workouts needing attention"
      description="Failed and unsupported Wahoo workouts appear here so you can retry them individually."
      actions={
        <RefreshButton
          accessibleName="Refresh workout errors"
          refreshing={isLoading || retryingId !== null}
          onRefresh={() => {
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
        />
      }
    >
      {isLoading && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading workout errors</span>
          <SkeletonBar className="h-10 w-full" />
          <SkeletonBar className="h-10 w-full" />
        </div>
      )}
      {!isLoading && imports.length === 0 && !error && (
        <EmptyState icon={CheckCircle2} title="No workouts need attention." />
      )}
      {imports.length > 0 && (
        <FramedList aria-label="Workouts needing attention">
          {imports.slice(0, 10).map((item) => (
            <FramedListItem
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Workout {item.workoutId}</p>
                <p className="text-muted-foreground capitalize">
                  {item.status}
                </p>
                {item.lastError && (
                  <p className="text-destructive-text break-words">
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
            </FramedListItem>
          ))}
        </FramedList>
      )}
      {imports.length > 10 && (
        <p className="text-muted-foreground text-xs">
          Showing 10 of {imports.length} workouts. Retry or resolve them to see
          the rest.
        </p>
      )}
      {!automaticImportAvailable && imports.length > 0 && (
        <Alert tone="warning" title="Retrying is unavailable.">
          Retrying workouts requires a durable background job queue on this
          server.
        </Alert>
      )}
      {error && <Alert title={error} />}
      {message && <Alert tone="success" title={message} />}
    </Section>
  )
}
