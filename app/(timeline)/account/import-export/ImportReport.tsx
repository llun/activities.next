'use client'

import type { AccountImportResponse } from '@/lib/client/accountImports'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

import { importErrorLabel, importReportRows } from './importCopy'

interface Props {
  accountImport: AccountImportResponse
  onStartAgain: () => void
}

export const ImportReport = ({ accountImport, onStartAgain }: Props) => {
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

  return (
    <div className="space-y-4">
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
