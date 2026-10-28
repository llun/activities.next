'use client'

import { useEffect, useRef } from 'react'

import type { AccountImportResponse } from '@/lib/client/accountImports'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

import { importErrorLabel, importReportRows } from './importCopy'

interface Props {
  accountImport: AccountImportResponse
  onStartAgain: () => void
  /**
   * Move focus to the report's alert: set only when the report appears
   * because the user just acted (they cancelled the import), not when the
   * page loads with a finished import — the dialog that confirmed the
   * action returns focus to a button that is about to unmount, so without
   * this the focus falls to the body and nothing is announced.
   */
  focusOnMount?: boolean
}

export const ImportReport = ({
  accountImport,
  onStartAgain,
  focusOnMount = false
}: Props) => {
  const alertRef = useRef<HTMLDivElement>(null)
  const rows = importReportRows(
    accountImport.report,
    accountImport.progress.profileImageSkips
  )
  const action =
    accountImport.status === 'failed' ? (
      <Button type="button" variant="outline" size="sm" onClick={onStartAgain}>
        Start again
      </Button>
    ) : null

  useEffect(() => {
    if (!focusOnMount) return
    alertRef.current?.focus()
    // A cancel dialog closing in the same commit can pull focus back into its
    // trap and drop it on <body> as it unmounts: take it again next frame.
    const frame = requestAnimationFrame(() => alertRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusOnMount])

  return (
    <div className="space-y-4">
      <div ref={alertRef} tabIndex={-1}>
        {accountImport.status === 'done' ? (
          <Alert tone="success" title="Import finished" />
        ) : accountImport.status === 'failed' ? (
          <Alert
            tone="error"
            title="We could not finish the import"
            action={action}
          >
            {importErrorLabel(accountImport.lastErrorCode)}
          </Alert>
        ) : (
          <Alert tone="info" title="Import cancelled" />
        )}
      </div>
      {rows.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {rows.map((row, index) => (
            <li key={`${index}-${row}`}>{row}</li>
          ))}
        </ul>
      ) : null}
      {accountImport.status !== 'failed' ? (
        <Button type="button" variant="outline" onClick={onStartAgain}>
          Import another file
        </Button>
      ) : null}
    </div>
  )
}
