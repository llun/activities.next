'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import {
  type WahooHistoryImport,
  cancelWahooHistory,
  getWahooHistory,
  retryWahooHistory,
  startWahooHistory
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

interface Props {
  connected: boolean
  automaticImportAvailable: boolean
}

const isInProgress = (status?: string) =>
  status === 'pending' || status === 'running'

export const WahooHistorySection = ({
  connected,
  automaticImportAvailable
}: Props) => {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [currentImport, setCurrentImport] = useState<WahooHistoryImport | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await getWahooHistory(signal)
    if (!signal?.aborted) setCurrentImport(result.import)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load import status'
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!isInProgress(currentImport?.status)) return
    const interval = setInterval(() => {
      void refresh().catch((pollError) => {
        setError(
          pollError instanceof Error
            ? pollError.message
            : 'Failed to refresh import status'
        )
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [currentImport?.status, refresh])

  const runAction = async (action: () => Promise<void>, success: string) => {
    setError('')
    setMessage('')
    setIsActing(true)
    try {
      await action()
      await refresh()
      setMessage(success)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Import action failed'
      )
    } finally {
      setIsActing(false)
    }
  }

  const start = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (fromDate > toDate) {
      setError('The start date must be on or before the end date.')
      return
    }
    void runAction(
      () => startWahooHistory(fromDate, toDate),
      'History import started.'
    )
  }

  return (
    <section
      aria-labelledby="wahoo-history-heading"
      className="space-y-4 border-t pt-6"
    >
      <div className="space-y-1">
        <h2 id="wahoo-history-heading" className="text-lg font-semibold">
          Import workout history
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose a date range to import earlier Wahoo workouts. Progress remains
          available here if you leave this page.
        </p>
      </div>

      <form onSubmit={start} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="wahoo-history-from">From</Label>
            <Input
              id="wahoo-history-from"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              required
              disabled={
                !connected ||
                !automaticImportAvailable ||
                isActing ||
                isInProgress(currentImport?.status)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wahoo-history-to">To</Label>
            <Input
              id="wahoo-history-to"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              required
              disabled={
                !connected ||
                !automaticImportAvailable ||
                isActing ||
                isInProgress(currentImport?.status)
              }
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={
            !connected ||
            !automaticImportAvailable ||
            isLoading ||
            isActing ||
            isInProgress(currentImport?.status) ||
            !fromDate ||
            !toDate
          }
        >
          {isActing ? 'Working…' : 'Import history'}
        </Button>
        {!connected && (
          <p className="text-sm text-muted-foreground">
            Connect Wahoo before importing workout history.
          </p>
        )}
        {connected && !automaticImportAvailable && (
          <p role="alert" className="text-sm text-muted-foreground">
            History import requires a durable background job queue on this
            server.
          </p>
        )}
      </form>

      {isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading import status…
        </p>
      )}
      {currentImport && (
        <div className="space-y-3 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {currentImport.fromDate} to {currentImport.toDate}
            </p>
            <span className="capitalize text-muted-foreground">
              {currentImport.status}
            </span>
          </div>
          <p className="text-muted-foreground">
            Imported {currentImport.completed}
            {currentImport.total > 0 ? ` of ${currentImport.total}` : ''}{' '}
            workouts
            {currentImport.failed > 0
              ? ` · ${currentImport.failed} failed`
              : ''}
          </p>
          {currentImport.total > 0 && (
            <progress
              className="w-full"
              value={currentImport.completed + currentImport.failed}
              max={currentImport.total}
              aria-label="History import progress"
            />
          )}
          {currentImport.lastError && (
            <p role="alert" className="text-destructive">
              {currentImport.lastError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {isInProgress(currentImport.status) && (
              <Button
                type="button"
                variant="outline"
                disabled={isActing}
                onClick={() =>
                  void runAction(
                    cancelWahooHistory,
                    'History import cancelled.'
                  )
                }
              >
                Cancel import
              </Button>
            )}
            {(currentImport.status === 'failed' ||
              currentImport.status === 'cancelled') && (
              <Button
                type="button"
                variant="outline"
                disabled={isActing}
                onClick={() =>
                  void runAction(
                    retryWahooHistory,
                    currentImport.status === 'cancelled'
                      ? 'History import resumed.'
                      : 'Retry started.'
                  )
                }
              >
                {currentImport.status === 'cancelled'
                  ? 'Resume history import'
                  : 'Retry failed workouts'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Imported activities appear in{' '}
            <Link href="/fitness/files" className="underline">
              Fitness files
            </Link>
            .
          </p>
        </div>
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
