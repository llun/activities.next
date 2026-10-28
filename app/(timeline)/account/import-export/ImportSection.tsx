'use client'

import { useState } from 'react'

import type { AccountImportResponse } from '@/lib/client/accountImports'
import {
  cancelAccountImport,
  getAccountImport
} from '@/lib/client/accountImports'
import { ApiRequestError } from '@/lib/client/http'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { formatBytes } from '@/lib/utils/formatBytes'

import { ArchiveImportForm } from './ArchiveImportForm'
import { CsvImportForm } from './CsvImportForm'
import { ImportProgress } from './ImportProgress'
import { ImportReport } from './ImportReport'
import { useImportPolling } from './useImportPolling'

interface Props {
  actorId: string
  handle: string
  currentTime: number
  initialImport: AccountImportResponse | null
  maxImportBytes: number
  maxCsvBytes: number
}

interface SelectionError {
  title: string
  message: string
}

const isActiveImport = (accountImport: AccountImportResponse | null) =>
  accountImport?.status === 'queued' || accountImport?.status === 'running'

export const ImportSection = ({
  actorId,
  handle,
  currentTime,
  initialImport,
  maxImportBytes,
  maxCsvBytes
}: Props) => {
  const [file, setFile] = useState<File | null>(null)
  const [selectionError, setSelectionError] = useState<SelectionError | null>(
    null
  )
  const [actorChangedLocally, setActorChangedLocally] = useState(false)
  const [moved, setMoved] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const isOffline = useConnectionStatus().state === 'offline'
  const {
    accountImport,
    setAccountImport,
    actorChanged: actorChangedWhilePolling
  } = useImportPolling({ actorId, initialImport })
  const actorChanged = actorChangedLocally || actorChangedWhilePolling

  const onFileChange = (selected: File | null) => {
    setSelectionError(null)
    if (!selected) {
      setFile(null)
      return
    }
    const filename = selected.name.toLowerCase()
    const maxBytes = filename.endsWith('.csv') ? maxCsvBytes : maxImportBytes
    if (!filename.endsWith('.zip') && !filename.endsWith('.csv')) {
      setFile(null)
      setSelectionError({
        title: 'We could not read this file',
        message:
          'Choose an activities.next archive, a Mastodon archive (.zip) or a Mastodon CSV file.'
      })
      return
    }
    if (selected.size === 0) {
      setFile(null)
      setSelectionError({ title: 'The file is empty', message: '' })
      return
    }
    if (selected.size > maxBytes) {
      setFile(null)
      setSelectionError({
        title: 'File is too large',
        message: `Choose a file no larger than ${formatBytes(maxBytes)}.`
      })
      return
    }
    setFile(selected)
  }

  const handleStartAgain = () => {
    setAccountImport(null)
    setFile(null)
    setSelectionError(null)
    setMoved(false)
  }

  const handleCancelImport = async () => {
    if (!accountImport || !isActiveImport(accountImport) || isOffline) return
    setCanceling(true)
    try {
      const cancelled = await cancelAccountImport({
        actorId,
        id: accountImport.id
      })
      try {
        setAccountImport(
          await getAccountImport({ actorId, id: accountImport.id })
        )
      } catch {
        setAccountImport(cancelled)
      }
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.message === 'Actor changed'
      ) {
        setActorChangedLocally(true)
      }
    } finally {
      setCanceling(false)
    }
  }

  const showForm = !accountImport && !actorChanged && !moved
  const showCsvForm = file?.name.toLowerCase().endsWith('.csv') ?? false

  return (
    <Section
      title="Import"
      description="Bring in an archive or a list from activities.next or Mastodon."
    >
      <div className="space-y-4">
        <Alert tone="info" title={`Posts will be imported into ${handle}`}>
          Switch profile first if they belong somewhere else. Imported posts
          keep their original dates. They are not sent to your followers, and
          nobody is notified.
        </Alert>

        {selectionError ? (
          <Alert tone="error" title={selectionError.title}>
            {selectionError.message}
          </Alert>
        ) : null}
        {actorChanged ? <ActorChangedAlert /> : null}
        {moved ? <Alert tone="info" title="This account has moved" /> : null}

        {showForm ? (
          showCsvForm ? (
            <CsvImportForm
              actorId={actorId}
              file={file!}
              maxCsvBytes={maxCsvBytes}
              onFileChange={onFileChange}
              onActorChanged={() => setActorChangedLocally(true)}
              onMoved={() => setMoved(true)}
            />
          ) : (
            <ArchiveImportForm
              actorId={actorId}
              currentTime={currentTime}
              file={file}
              maxImportBytes={maxImportBytes}
              onFileChange={onFileChange}
              onActorChanged={() => setActorChangedLocally(true)}
              onMoved={() => setMoved(true)}
              onStarted={setAccountImport}
            />
          )
        ) : null}

        {accountImport && !actorChanged && isActiveImport(accountImport) ? (
          <ImportProgress
            accountImport={accountImport}
            currentTime={currentTime}
            canceling={canceling}
            onCancel={() => void handleCancelImport()}
          />
        ) : null}
        {accountImport && !actorChanged && !isActiveImport(accountImport) ? (
          <ImportReport
            accountImport={accountImport}
            onStartAgain={handleStartAgain}
          />
        ) : null}
      </div>
    </Section>
  )
}
