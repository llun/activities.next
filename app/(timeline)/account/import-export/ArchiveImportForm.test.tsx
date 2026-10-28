/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as accountImports from '@/lib/client/accountImports'
import type {
  AccountImportOptions,
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
const connectionState = { offline: false }

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({
    state: connectionState.offline ? 'offline' : 'online'
  })
}))

const actorId = 'https://llun.test/users/may'

const INITIAL_OPTIONS: AccountImportOptions = {
  likes: false,
  bookmarks: false,
  repliesToOthers: 'skip',
  profile: false,
  settings: false
}

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

const filePickerRef: RefObject<HTMLButtonElement | null> = { current: null }
const formRef: RefObject<HTMLFormElement | null> = { current: null }

const Harness = ({
  notStartedImport = null,
  startInFlight = false,
  onStarted = vi.fn(),
  onUploaded = vi.fn(),
  onSubmitStart = vi.fn(),
  onMoved = vi.fn()
}: {
  notStartedImport?: AccountImportResponse | null
  startInFlight?: boolean
  onStarted?: (accountImport: AccountImportResponse) => void
  onUploaded?: (uploaded: PresignedAccountImportResponse) => void
  onSubmitStart?: () => void
  onMoved?: () => void
}) => {
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState(INITIAL_OPTIONS)
  return (
    <ArchiveImportForm
      actorId={actorId}
      file={file}
      maxImportBytes={1024 * 1024}
      notStartedImport={notStartedImport}
      options={options}
      onOptionsChange={setOptions}
      onFileChange={setFile}
      onActorChanged={vi.fn()}
      onMoved={onMoved}
      onStarted={onStarted}
      onUploaded={onUploaded}
      onSubmitStart={onSubmitStart}
      startInFlight={startInFlight}
      filePickerRef={filePickerRef}
      formRef={formRef}
    />
  )
}

const chooseFile = (name: string) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File(['file data'], name)
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ArchiveImportForm', () => {
  beforeEach(() => {
    connectionState.offline = false
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
    vi.mocked(accountImports.listAccountImports).mockResolvedValue([baseImport])
    vi.mocked(accountImports.cancelAccountImport).mockResolvedValue(baseImport)
  })

  const submit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

  it('hands the uploaded row to the section and never starts it itself', async () => {
    const onUploaded = vi.fn()
    render(<Harness onUploaded={onUploaded} />)
    chooseFile('archive.zip')
    submit()

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(presigned))
    expect(accountImports.startAccountImport).not.toHaveBeenCalled()
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

  it("cancels the upload's row when the upload answers moved", async () => {
    vi.mocked(accountImports.uploadAccountImport).mockRejectedValueOnce(
      new ApiRequestError('This account has moved', 422)
    )
    const onMoved = vi.fn()

    render(<Harness onMoved={onMoved} />)
    chooseFile('archive.zip')
    submit()

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
  })

  it('moves focus to Try again when the upload is cancelled', async () => {
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

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.click(cancel)

    const tryAgain = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(tryAgain))
  })

  it('falls back to the file picker when Try again is disabled while offline', async () => {
    const upload = deferred<void>()
    vi.mocked(accountImports.uploadAccountImport).mockReturnValueOnce(
      upload.promise
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    cancel.focus()
    connectionState.offline = true
    await act(async () => {
      upload.reject(new ApiRequestError('The archive upload did not finish', 0))
    })

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
    // Try again cannot take the focus while offline, so the hand-off
    // falls through to the file picker.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change file' })
      )
    )
  })

  it('disables the generic Retry while offline and falls back to the file picker', async () => {
    const presign = deferred<PresignedAccountImportResponse>()
    vi.mocked(accountImports.createPresignedImport).mockReturnValueOnce(
      presign.promise
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    // The connection drops while the presign is in flight, so the Retry
    // that appears with its failure can only be a silent no-op.
    connectionState.offline = true
    await act(async () => {
      presign.reject(new TypeError('Failed to fetch'))
    })

    expect(
      await screen.findByText('Could not prepare the archive upload')
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(accountImports.createPresignedImport).toHaveBeenCalledTimes(1)

    // The disabled Retry cannot take the focus the pressed Import
    // archive dropped, so the hand-off falls through to the file picker.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change file' })
      )
    )
  })

  it('aborts the upload and cancels the import when the form unmounts mid-upload', async () => {
    vi.mocked(accountImports.uploadAccountImport).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new ApiRequestError('The archive upload was cancelled', 0))
          })
        })
    )
    const onUploaded = vi.fn()

    const { unmount } = render(<Harness onUploaded={onUploaded} />)
    chooseFile('archive.zip')
    submit()

    await screen.findByRole('button', { name: 'Cancel' })
    unmount()

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
    expect(onUploaded).not.toHaveBeenCalled()
    expect(accountImports.startAccountImport).not.toHaveBeenCalled()
  })

  it('shows the plain fallback when the presign fails with a network error', async () => {
    vi.mocked(accountImports.createPresignedImport).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    expect(
      await screen.findByText('Could not prepare the archive upload')
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('hands the active import to the section when the presign answers 409 already active', async () => {
    vi.mocked(accountImports.createPresignedImport).mockRejectedValueOnce(
      new ApiRequestError('An import is already active', 409)
    )
    const onStarted = vi.fn()
    render(<Harness onStarted={onStarted} />)

    chooseFile('archive.zip')
    submit()

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(baseImport))
    expect(accountImports.listAccountImports).toHaveBeenCalledWith({ actorId })
    expect(
      screen.queryByText('Could not start the import')
    ).not.toBeInTheDocument()
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

  it('describes each hinted switch by its hint', () => {
    render(<Harness />)
    chooseFile('archive.zip')

    expect(
      screen.getByRole('switch', { name: 'Import likes' })
    ).toHaveAccessibleDescription('Only for posts already on this server.')
    expect(
      screen.getByRole('switch', {
        name: "Import replies to other people's posts"
      })
    ).toHaveAccessibleDescription(
      "Off: your replies to other people's posts are skipped. On: they come in as standalone posts that link to the original."
    )
  })

  it('disables Import archive while an earlier upload waits to be started', () => {
    render(<Harness notStartedImport={notStarted} />)
    chooseFile('other.zip')

    expect(
      screen.getByText('Start or discard the earlier upload first')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import archive' })
    ).toBeDisabled()
  })

  it("disables Import archive and says You're offline while offline", () => {
    connectionState.offline = true
    render(<Harness />)
    chooseFile('archive.zip')

    expect(screen.getByText("You're offline")).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import archive' })
    ).toBeDisabled()

    // The section's Try again submits the form itself, so the offline guard
    // must hold on that path too, not only on the disabled button.
    act(() => {
      formRef.current!.requestSubmit()
    })
    expect(accountImports.createPresignedImport).not.toHaveBeenCalled()
  })

  it('says Choose a file to start. while no file is chosen', () => {
    render(<Harness />)

    expect(screen.getByText('Choose a file to start.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import archive' })
    ).toBeDisabled()

    chooseFile('archive.zip')

    expect(
      screen.queryByText('Choose a file to start.')
    ).not.toBeInTheDocument()
  })

  it('locks the form while the section starts or discards the earlier upload', () => {
    render(<Harness notStartedImport={notStarted} startInFlight />)

    // The lock disables the button, but nothing of the form's own is
    // importing: the label stays "Import archive".
    expect(
      screen.getByRole('button', { name: 'Import archive' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled()
    expect(
      screen.getByText('Start or discard the earlier upload first')
    ).toBeInTheDocument()
  })

  it('announces the upload once instead of on every progress tick', async () => {
    let reportProgress:
      ((progress: { loaded: number; total: number }) => void) | undefined
    vi.mocked(accountImports.uploadAccountImport).mockImplementation(
      ({ onProgress }) => {
        reportProgress = onProgress
        onProgress?.({ loaded: 10, total: 100 })
        return new Promise(() => {})
      }
    )

    render(<Harness />)
    chooseFile('archive.zip')
    submit()

    await waitFor(() =>
      expect(screen.getByText('10 B of 100 B · 10%')).toBeInTheDocument()
    )
    // The form's own upload is what is importing, so its button says so.
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Uploading the archive')

    act(() => {
      reportProgress?.({ loaded: 50, total: 100 })
    })

    expect(screen.getByText('50 B of 100 B · 50%')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(status)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Uploading the archive'
    )
  })
})
