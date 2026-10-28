'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { useEffect, useRef, useState } from 'react'

import type { AccountImportResponse } from '@/lib/client/accountImports'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Progress } from '@/lib/components/ui/progress'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'

import { importPhaseLabel } from './importCopy'

interface Props {
  accountImport: AccountImportResponse
  currentTime: number
  canceling?: boolean
  offline?: boolean
  /**
   * Move focus to the "Import in progress" heading: set only when the
   * progress appears because the user just started the import, not when the
   * page loads with a running one — the form that held the focused button
   * unmounts, and a live region that mounts with its content is usually not
   * announced.
   */
  focusOnMount?: boolean
  onCancel: () => void
}

const formatCount = (value: number) => value.toLocaleString('en-US')

const kindLabel = (kind: string) =>
  kind === 'activities.next' ? 'activities.next archive' : 'Mastodon archive'

export const ImportProgress = ({
  accountImport,
  currentTime,
  canceling = false,
  offline = false,
  focusOnMount = false,
  onCancel
}: Props) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clock, setClock] = useState(currentTime)
  const headingRef = useRef<HTMLDivElement>(null)
  const hasHydrated = useHasHydrated()
  const { completedItems, totalItems } = accountImport.progress
  const progressValue =
    totalItems > 0
      ? Math.min(100, Math.round((completedItems / totalItems) * 100))
      : null

  useEffect(() => {
    if (hasHydrated) setClock(Date.now())
  }, [hasHydrated, accountImport])

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])

  const confirmCancel = () => {
    setConfirmOpen(false)
    onCancel()
  }

  return (
    <div className="space-y-4">
      <Frame className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div ref={headingRef} tabIndex={-1} className="space-y-1">
            <p className="font-medium">Import in progress</p>
            {accountImport.startedAt ? (
              <p className="text-sm text-muted-foreground">
                Started{' '}
                {hasHydrated
                  ? formatDistance(
                      new Date(accountImport.startedAt),
                      new Date(clock),
                      { addSuffix: true }
                    )
                  : 'recently'}
              </p>
            ) : null}
          </div>
          <span className="text-sm font-medium">
            {accountImport.status === 'queued'
              ? 'Waiting to start'
              : 'In progress'}
          </span>
        </div>

        {/* The phase and the count are the news (a phase change, "x of y");
            the Progress bar stays outside the live region so every percent
            tick is not announced. */}
        <div role="status" className="space-y-2">
          <p className="text-sm font-medium">
            {importPhaseLabel(accountImport.phase)}
          </p>
          <p className="text-sm">
            {formatCount(completedItems)} of {formatCount(totalItems)} completed
          </p>
        </div>
        <Progress value={progressValue} aria-label="Archive import progress" />

        {accountImport.kind ? (
          <p className="text-sm text-muted-foreground">
            Found in this file: {kindLabel(accountImport.kind)} ·{' '}
            {formatCount(totalItems)} {totalItems === 1 ? 'item' : 'items'}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t pt-3">
          {offline ? (
            <span className="text-sm text-muted-foreground">
              You're offline
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={canceling || offline}
            onClick={() => setConfirmOpen(true)}
          >
            {canceling ? 'Cancelling…' : 'Cancel import'}
          </Button>
        </div>
      </Frame>

      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this import?"
        description="Items already imported stay. The rest is not imported."
        cancelLabel="Keep importing"
        confirmLabel="Cancel import"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmCancel}
      />
    </div>
  )
}
