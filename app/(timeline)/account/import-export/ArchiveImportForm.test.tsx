/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as accountImports from '@/lib/client/accountImports'
import type {
  AccountImportResponse,
  PresignedAccountImportResponse
} from '@/lib/client/accountImports'
import { ApiRequestError } from '@/lib/client/http'
import { formatBytes } from '@/lib/utils/formatBytes'

import { ArchiveImportForm } from './ArchiveImportForm'

vi.mock('@/lib/client/accountImports', () => ({
  cancelAccountImport: vi.fn(),
  createPresignedImport: vi.fn(),
  getAccountImport: vi.fn(),
  listAccountImports: vi.fn(),
  startAccountImport: vi.fn(),
  uploadAccountImport: vi.fn()
}))
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ state: 'online' })
}))
vi.mock('@/lib/hooks/useHasHydrated', () => ({
  useHasHydrated: () => true
}))

const actorId = 'https://llun.test/users/may'

const baseImport = {
  id: 'archive-1',
  status: 'running' as const,
  kind: 'activities.next' as const,
  phase: 'inspect',
  progress: {
    version: 1 as const,
    sourceActorId: null,
    sourceFollowersUrl: null,
    statusOrder: 'newest-first' as const,
    catalogStage: 'statuses' as const,
    catalogIndex: 0,
    totalItems: 0,
    completedItems: 0,
    skippedItems: 0,
    continuationCount: 0
  },
  createdAt: '2026-10-28T10:00:00.000Z',
  startedAt: '2026-10-28T10:00:00.000Z',
  finishedAt: null,
  lastErrorCode: null
}

const presigned: PresignedAccountImportResponse = {
  ...baseImport,
  status: 'queued',
  kind: null,
  phase: null,
  startedAt: null,
  uploadUrl: 'https://storage.example/upload',
  directUploadPath: null
}

const notStarted: AccountImportResponse = {
  ...baseImport,
  status: 'queued',
  kind: null,
  phase: null,
  startedAt: null
}

const Harness = ({
  notStartedImport = null
}: {
  notStartedImport?: AccountImportResponse | null
}) => {
  const [file, setFile] = useState<File | null>(null)
  return (
    <ArchiveImportForm
      actorId={actorId}
      currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
      file={file}
      maxImportBytes={1024 * 1024}
      notStartedImport={notStartedImport}
      onFileChange={setFile}
      onActorChanged={vi.fn()}
      onMoved={vi.fn()}
      onStarted={vi.fn()}
      onDiscarded={vi.fn()}
    />
  )
}

const chooseFile = (name: string) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File(['file data'], name)
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

describe('ArchiveImportForm', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  beforeEach(() => {
    vi.mocked(accountImports.createPresignedImport).mockResolvedValue(presigned)
    vi.mocked(accountImports.uploadAccountImport).mockResolvedValue(undefined)
    vi.mocked(accountImports.startAccountImport).mockResolvedValue(baseImport)
    vi.mocked(accountImports.listAccountImports).mockResolvedValue([baseImport])
    vi.mocked(accountImports.cancelAccountImport).mockResolvedValue(baseImport)
  })

  const submit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

  it('keeps the stored upload and retries only the start when start fails with 503', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockResolvedValueOnce(baseImport)

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(accountImports.createPresignedImport).toHaveBeenCalledTimes(1)
    expect(accountImports.uploadAccountImport).toHaveBeenCalledTimes(1)
  })

  it('cancels the stored import when another file is chosen after a 429', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 60_000)
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()

    chooseFile('other.zip')

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
  })

  it('cancels the stored import when the form unmounts after a 429', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 60_000)
    )

    const { unmount } = render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()
    unmount()

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
  })

  it('aborts the upload on Cancel, cancels the import and never starts', async () => {
    vi.mocked(accountImports.uploadAccountImport).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new ApiRequestError('The archive upload was cancelled', 0))
          })
        })
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(accountImports.startAccountImport).not.toHaveBeenCalled()
  })

  it('shows the active import via listAccountImports on a 409 already-active start', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('An import is already active', 409)
    )
    const onStarted = vi.fn()
    render(
      <ArchiveImportForm
        actorId={actorId}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        file={new File(['data'], 'archive.zip')}
        maxImportBytes={1024 * 1024}
        notStartedImport={null}
        onFileChange={vi.fn()}
        onActorChanged={vi.fn()}
        onMoved={vi.fn()}
        onStarted={onStarted}
        onDiscarded={vi.fn()}
      />
    )
    submit()

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(baseImport))
    expect(accountImports.listAccountImports).toHaveBeenCalledWith({ actorId })
  })

  it('treats a 409 upload-incomplete start failure as an upload failure', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Upload is incomplete; upload it again', 409)
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
  })

  it('shows the unreadable alert without an action for an unrecognised archive', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Archive format is not recognised', 422)
    )

    render(<Harness />)
    chooseFile('photos.zip')
    submit()

    expect(
      await screen.findByText('We could not read this file')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
  })

  it('shows the server message for other 422 start errors', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('This account is being deleted', 422)
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('This account is being deleted')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('We could not read this file')
    ).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
  })

  it('measures the retry time from the moment the rate limit arrives', async () => {
    const start = Date.parse('2026-10-28T10:00:00.000Z')
    let now = start
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 7_200_000)
    )

    render(<Harness />)
    chooseFile('archive.zip')
    // Forty minutes pass between hydration and the rate-limited start.
    now = start + 40 * 60 * 1000
    submit()

    expect(
      await screen.findByText('You can try again in about 2 hours.')
    ).toBeInTheDocument()
  })

  it('labels the visible file field, not the hidden input', () => {
    render(<Harness />)
    chooseFile('archive.zip')

    const field = screen.getByLabelText('File')
    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveValue(`archive.zip · ${formatBytes(9)}`)
    expect(field.getAttribute('aria-describedby')).toContain('hint')
    expect(
      document.querySelector<HTMLInputElement>('input[type="file"]')!.id
    ).toBe('')
  })

  it('offers to start or discard an upload that was never started', async () => {
    vi.mocked(accountImports.startAccountImport).mockResolvedValue(baseImport)

    render(<Harness notStartedImport={notStarted} />)

    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledWith({
        actorId,
        importId: 'archive-1',
        options: {
          likes: false,
          bookmarks: false,
          repliesToOthers: 'skip',
          profile: false,
          settings: false
        }
      })
    )
  })

  it('discards an upload that was never started', async () => {
    const onDiscarded = vi.fn()
    render(
      <ArchiveImportForm
        actorId={actorId}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        file={null}
        maxImportBytes={1024 * 1024}
        notStartedImport={notStarted}
        onFileChange={vi.fn()}
        onActorChanged={vi.fn()}
        onMoved={vi.fn()}
        onStarted={vi.fn()}
        onDiscarded={onDiscarded}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledOnce())
  })
})
