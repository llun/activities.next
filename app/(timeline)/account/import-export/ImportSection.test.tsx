/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as accountImports from '@/lib/client/accountImports'
import type { BulkImportResponse } from '@/lib/client/bulkImports'
import * as bulkImports from '@/lib/client/bulkImports'
import { ApiRequestError } from '@/lib/client/http'

import { ImportSection } from './ImportSection'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ state: 'online' })
}))
vi.mock('@/lib/client/connection', () => ({
  onConnectionRestored: () => () => undefined
}))
vi.mock('@/lib/client/accountImports', () => ({
  cancelAccountImport: vi.fn().mockResolvedValue({}),
  createPresignedImport: vi.fn(),
  getAccountImport: vi.fn(),
  listAccountImports: vi.fn(),
  startAccountImport: vi.fn(),
  uploadAccountImport: vi.fn()
}))
vi.mock('@/lib/client/bulkImports', () => ({
  createBulkImport: vi.fn(),
  getBulkImport: vi.fn()
}))

const actorId = 'https://llun.test/users/may'

const activeImport = {
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

const queuedNotStarted = {
  ...activeImport,
  status: 'queued' as const,
  kind: null,
  phase: null,
  startedAt: null
}

const cancelledNotStarted = {
  ...activeImport,
  status: 'cancelled' as const,
  kind: null,
  phase: null,
  startedAt: null,
  finishedAt: '2026-10-28T10:05:00.000Z'
}

const finishedImport = {
  ...activeImport,
  status: 'done' as const,
  finishedAt: '2026-10-28T10:05:00.000Z',
  report: { done: { status: 10 }, skipped: {}, failed: {} }
}

const failedImport = {
  ...activeImport,
  status: 'failed' as const,
  finishedAt: '2026-10-28T10:05:00.000Z',
  lastErrorCode: null
}

const finishedBulkImport: BulkImportResponse = {
  id: 'bulk-1',
  type: 'following',
  mode: 'merge',
  state: 'finished',
  originalFilename: 'following_accounts.csv',
  totalItems: 5,
  processedItems: 5,
  importedItems: 5,
  failedItems: 0,
  createdAt: '2026-10-28T10:00:00.000Z',
  finishedAt: '2026-10-28T10:01:00.000Z'
}

const renderSection = () =>
  render(
    <ImportSection
      actorId={actorId}
      handle="@may@llun.test"
      currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
      initialImport={null}
      maxImportBytes={1024 * 1024}
      maxCsvBytes={5 * 1024 * 1024}
    />
  )

const renderWithImport = (initialImport: unknown) =>
  render(
    <ImportSection
      actorId={actorId}
      handle="@may@llun.test"
      currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
      initialImport={initialImport as never}
      maxImportBytes={1024 * 1024}
      maxCsvBytes={5 * 1024 * 1024}
    />
  )

const chooseFile = (name: string) => {
  const file = new File(['file data'], name)
  fireEvent.change(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    { target: { files: [file] } }
  )
  return file
}

const submitArchive = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

describe('ImportSection', () => {
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
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(accountImports.cancelAccountImport).mockResolvedValue({} as never)
    vi.mocked(accountImports.createPresignedImport).mockResolvedValue({
      ...activeImport,
      status: 'queued',
      kind: null,
      phase: null,
      startedAt: null,
      uploadUrl: 'https://storage.example/upload',
      directUploadPath: null
    })
    vi.mocked(accountImports.uploadAccountImport).mockResolvedValue(undefined)
    vi.mocked(accountImports.startAccountImport).mockResolvedValue(activeImport)
    vi.mocked(accountImports.listAccountImports).mockResolvedValue([
      activeImport
    ])
  })

  it('keeps the archive flow presign → upload → start', async () => {
    const calls: string[] = []
    vi.mocked(accountImports.createPresignedImport).mockImplementation(
      async () => {
        calls.push('presign')
        return {
          ...activeImport,
          status: 'queued',
          kind: null,
          phase: null,
          uploadUrl: 'https://storage.example/upload',
          directUploadPath: null
        }
      }
    )
    vi.mocked(accountImports.uploadAccountImport).mockImplementation(
      async () => {
        calls.push('upload')
      }
    )
    vi.mocked(accountImports.startAccountImport).mockImplementation(
      async () => {
        calls.push('start')
        return activeImport
      }
    )

    renderSection()
    const file = chooseFile('archive.zip')
    submitArchive()

    await waitFor(() => expect(calls).toEqual(['presign', 'upload', 'start']))
    expect(accountImports.createPresignedImport).toHaveBeenCalledWith({
      actorId,
      size: file.size
    })
    expect(accountImports.uploadAccountImport).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, file, uploadUrl: expect.any(String) })
    )
    expect(accountImports.startAccountImport).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it('cancels best-effort and shows the upload failure alert without starting', async () => {
    vi.mocked(accountImports.uploadAccountImport).mockRejectedValueOnce(
      new ApiRequestError('The network was interrupted', 0)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(accountImports.startAccountImport).not.toHaveBeenCalled()
  })

  it('retries a 429 by starting the stored upload again without uploading it again', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
      .mockResolvedValueOnce(activeImport)
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(accountImports.createPresignedImport).toHaveBeenCalledTimes(1)
    expect(accountImports.uploadAccountImport).toHaveBeenCalledTimes(1)
  })

  it('retries a kept start after a 503 without uploading again', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockResolvedValueOnce(activeImport)
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(accountImports.createPresignedImport).toHaveBeenCalledTimes(1)
    expect(accountImports.uploadAccountImport).toHaveBeenCalledTimes(1)
  })

  it('shows the unreadable-file alert and cancels after start returns 422', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Archive format is not recognised', 422)
    )
    renderSection()
    chooseFile('photos.zip')
    submitArchive()

    expect(
      await screen.findByText('We could not read this file')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
  })

  it('shows the server message for other 422 start errors without cancelling', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('This account is being deleted', 422)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('This account is being deleted')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('We could not read this file')
    ).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('treats a 409 upload-incomplete start failure as an upload failure', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Upload is incomplete; upload it again', 409)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(
      screen.queryByText('An earlier upload was not started')
    ).not.toBeInTheDocument()
  })

  it('uploads the chosen file again from Try again after a 409 upload-incomplete start', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Upload is incomplete; upload it again', 409)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(accountImports.uploadAccountImport).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(accountImports.uploadAccountImport).toHaveBeenCalledTimes(2)
    })
    expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
  })

  it('shows the active import via listAccountImports on a 409 already-active start', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('An import is already active', 409)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(await screen.findByText('Import in progress')).toBeInTheDocument()
    expect(accountImports.listAccountImports).toHaveBeenCalledWith({ actorId })
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('re-reads the import on a 409 not-queued start instead of cancelling it', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is not queued', 409)
    )
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(activeImport)
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    expect(await screen.findByText('Import in progress')).toBeInTheDocument()
    expect(accountImports.getAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('treats a start of an upload discarded elsewhere as gone, not as a cancelled report', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is not queued', 409)
    )
    vi.mocked(accountImports.getAccountImport).mockResolvedValueOnce(
      cancelledNotStarted as never
    )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('File')).toBeInTheDocument()
    expect(screen.queryByText('Import cancelled')).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('shows the plain fallback when the start fails with a network error', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    expect(
      await screen.findByText('Could not start the import')
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('measures the retry time from the moment the rate limit arrives', async () => {
    const start = Date.parse('2026-10-28T10:00:00.000Z')
    let now = start
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 7_200_000)
    )

    renderSection()
    chooseFile('archive.zip')
    // Forty minutes pass between hydration and the rate-limited start.
    now = start + 40 * 60 * 1000
    submitArchive()

    expect(
      await screen.findByText('You can try again in about 2 hours.')
    ).toBeInTheDocument()
  })

  it('shows five unchecked switches for ZIPs and no CSV controls', () => {
    renderSection()
    chooseFile('archive.zip')

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(5)
    expect(
      switches.every(
        (toggle) => toggle.getAttribute('aria-checked') === 'false'
      )
    ).toBe(true)
    expect(
      screen.getByText('Only for posts already on this server.')
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('What is in this file')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('shows the switches only once a .zip that passed the checks is chosen', () => {
    renderSection()
    // Nothing chosen yet: the mockup board shows only the File row.
    expect(screen.getByText('Choose a file to start.')).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)

    // An unrecognised, an empty and a too-large file all leave the form
    // without a file, so none of them may bring the switches up either.
    chooseFile('photos.txt')
    expect(screen.getByText('We could not read this file')).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)

    const empty = new File([], 'a.zip')
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [empty] } }
    )
    expect(screen.getByText('The file is empty')).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)

    const tooLarge = new File(['too large'], 'a.zip')
    Object.defineProperty(tooLarge, 'size', { value: 2 * 1024 * 1024 })
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [tooLarge] } }
    )
    expect(screen.getByText('File is too large')).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)

    chooseFile('a.zip')
    expect(screen.getAllByRole('switch')).toHaveLength(5)
  })

  it('shows no switches while only a page-load earlier upload waits', () => {
    renderWithImport(queuedNotStarted)

    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('shows a guessed CSV Select, Merge and Overwrite cards, with an outside warning', () => {
    renderSection()
    chooseFile('following_accounts.csv')

    expect(screen.getByLabelText('What is in this file')).toHaveValue(
      'following'
    )
    expect(screen.getByRole('radio', { name: /Merge/ })).toBeInTheDocument()
    const overwrite = screen.getByRole('radio', { name: /Overwrite/ })
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    fireEvent.click(overwrite)

    const warning = screen.getByText('Overwrite replaces your current list')
    expect(warning).toBeInTheDocument()
    expect(warning.closest('[data-slot="frame"]')).toBeNull()
    expect(
      within(
        screen.getByRole('radiogroup', { name: 'When importing' })
      ).getByRole('radio', { name: /Overwrite/ })
    ).toBeChecked()
  })

  it('shows ActorChangedAlert instead of the form on 409 actor mismatch', async () => {
    vi.mocked(accountImports.createPresignedImport).mockRejectedValueOnce(
      new ApiRequestError('Actor changed', 409)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('Your active profile changed')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
  })

  it('hides the form when the current profile has moved', async () => {
    vi.mocked(accountImports.createPresignedImport).mockRejectedValueOnce(
      new ApiRequestError('This account has moved', 422)
    )
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(
      await screen.findByText('This account has moved')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
  })

  it('checks the selected file size before making any request', async () => {
    renderSection()
    const file = new File(['too large'], 'archive.zip')
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 })
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [file] } }
    )

    expect(await screen.findByText('File is too large')).toBeInTheDocument()
    expect(accountImports.createPresignedImport).not.toHaveBeenCalled()
  })

  it('offers a queued upload that never started instead of progress', async () => {
    renderWithImport(queuedNotStarted)

    expect(screen.queryByText('Import in progress')).not.toBeInTheDocument()
    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('File')).toBeInTheDocument()

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
    expect(await screen.findByText('Import in progress')).toBeInTheDocument()
  })

  it('retries a failed start of an earlier upload without a file', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockResolvedValueOnce(activeImport)
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(accountImports.createPresignedImport).not.toHaveBeenCalled()
    expect(accountImports.uploadAccountImport).not.toHaveBeenCalled()
  })

  it('discards a queued upload that never started', async () => {
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByText('An earlier upload was not started')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText('File')).toBeInTheDocument()
  })

  it('keeps the earlier upload and shows the error when Discard fails', async () => {
    vi.mocked(accountImports.cancelAccountImport)
      .mockRejectedValueOnce(new ApiRequestError('Server error', 500))
      .mockResolvedValue({} as never)
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(
      await screen.findByText('Could not discard the upload')
    ).toBeInTheDocument()
    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Could not discard the upload')
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByText('An earlier upload was not started')
    ).not.toBeInTheDocument()
  })

  it('treats a 409 already-finished Discard as discarded', async () => {
    vi.mocked(accountImports.cancelAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is already finished', 409)
    )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(
        screen.queryByText('An earlier upload was not started')
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByText('Could not discard the upload')
    ).not.toBeInTheDocument()
  })

  it('shows the actor-changed alert when Discard answers 409 Actor changed', async () => {
    vi.mocked(accountImports.cancelAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Actor changed', 409)
    )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(
      await screen.findByText('Your active profile changed')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('An earlier upload was not started')
    ).not.toBeInTheDocument()
  })

  it('cancels a running import through the confirm dialog and shows the report', async () => {
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'cancelled',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)
    renderWithImport(activeImport)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
        actorId,
        id: 'archive-1'
      })
    )
    expect(await screen.findByText('Import cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Import in progress')).not.toBeInTheDocument()
  })

  it('replaces progress with the report when polling reaches a terminal status', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    renderWithImport(activeImport)
    expect(screen.getByText('Import in progress')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(screen.queryByText('Import in progress')).not.toBeInTheDocument()
  })

  it('moves focus to the report when the poll ends an import the user started', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      await Promise.resolve()
    })
    // The start moved the focus into the progress view.
    const heading = screen.getByText('Import in progress')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading.parentElement)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    // The progress view unmounted with the focus inside it, so the report
    // must take the focus itself and be announced.
    const reportAlert = screen
      .getByText('Import finished')
      .closest('[data-slot="alert"]')
    await waitFor(() => {
      expect(document.activeElement).toBe(reportAlert?.parentElement)
      expect(document.activeElement).toHaveAttribute('tabindex', '-1')
    })
  })

  it('leaves focus alone when the poll ends an import the user is not watching', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    render(
      <>
        <button type="button">Elsewhere</button>
        <ImportSection
          actorId={actorId}
          handle="@may@llun.test"
          currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
          initialImport={activeImport}
          maxImportBytes={1024 * 1024}
          maxCsvBytes={5 * 1024 * 1024}
        />
      </>
    )
    screen.getByRole('button', { name: 'Elsewhere' }).focus()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Elsewhere' })
    )
  })

  it('moves focus to the report when the poll ends an import while the cancel confirm is open', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    renderWithImport(activeImport)
    const cancel = screen.getByRole('button', { name: 'Cancel import' })
    cancel.focus()
    fireEvent.click(cancel)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // The confirm dialog is portalled outside the progress view and holds
    // the focus while the user decides whether to cancel.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The dialog unmounted with the focus inside it, so the report must
    // take the focus itself and be announced.
    const reportAlert = screen
      .getByText('Import finished')
      .closest('[data-slot="alert"]')
    await waitFor(() => {
      expect(document.activeElement).toBe(reportAlert?.parentElement)
      expect(document.activeElement).toHaveAttribute('tabindex', '-1')
    })
  })

  it('disables the upload-failure Try again while a .csv is chosen', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Upload is incomplete; upload it again', 409)
    )
    renderWithImport(queuedNotStarted)
    // A .csv swaps the archive form for the CSV form, so the section's
    // Try again has no archive form to submit any more.
    chooseFile('following_accounts.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    fireEvent.click(tryAgain)
    await act(async () => undefined)
    expect(accountImports.createPresignedImport).not.toHaveBeenCalled()
    expect(accountImports.uploadAccountImport).not.toHaveBeenCalled()
  })

  it('shows the finished import when cancelling answers 409 already finished', async () => {
    vi.mocked(accountImports.cancelAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is already finished', 409)
    )
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    renderWithImport(activeImport)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )

    // The import finished between the last poll and the cancel: it is over,
    // not failed, so the report shows instead of the cancel error.
    expect(await screen.findByText('Import finished')).toBeInTheDocument()
    expect(accountImports.getAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(
      screen.queryByText('Could not cancel the import')
    ).not.toBeInTheDocument()
    // The report takes the focus the closing dialog leaves on the button
    // that unmounts with the progress view.
    const reportAlert = screen
      .getByText('Import finished')
      .closest('[data-slot="alert"]')
    await waitFor(() =>
      expect(document.activeElement).toBe(reportAlert?.parentElement)
    )
  })

  it('shows an error alert when cancelling fails, and retries', async () => {
    vi.mocked(accountImports.cancelAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Could not cancel the import', 500)
      )
      .mockResolvedValueOnce({} as never)
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'cancelled',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)
    renderWithImport(activeImport)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )

    expect(
      await screen.findByText('Could not cancel the import')
    ).toBeInTheDocument()
    expect(screen.getByText('Import in progress')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(accountImports.cancelAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(await screen.findByText('Import cancelled')).toBeInTheDocument()
    expect(
      screen.queryByText('Could not cancel the import')
    ).not.toBeInTheDocument()
  })

  it('keeps the start failure alert when starting an earlier upload fails, and never reports it as cancelled', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Archive format is not recognised', 422)
    )
    // Without the fix the next poll returns the row the failed start
    // cancelled, and the report claims the user cancelled it.
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'cancelled',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)

    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    // Let the failed start cancel the row and tell the section to drop it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('We could not read this file')).toBeInTheDocument()
    expect(
      screen.queryByText('An earlier upload was not started')
    ).not.toBeInTheDocument()

    // The next poll tick must not turn the failed start into a report that
    // claims the user cancelled the import.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('We could not read this file')).toBeInTheDocument()
    expect(screen.queryByText('Import cancelled')).not.toBeInTheDocument()
    expect(accountImports.getAccountImport).not.toHaveBeenCalled()
  })

  it('keeps an earlier upload whose start was rate-limited when another file is chosen', async () => {
    vi.useFakeTimers()
    let cancelled = false
    vi.mocked(accountImports.cancelAccountImport).mockImplementation(
      async () => {
        cancelled = true
        return {} as never
      }
    )
    // If the earlier upload were cancelled behind the page's back, the next
    // poll would report it as cancelled.
    vi.mocked(accountImports.getAccountImport).mockImplementation(
      async () =>
        (cancelled
          ? {
              ...activeImport,
              status: 'cancelled' as const,
              finishedAt: '2026-10-28T10:05:00.000Z'
            }
          : queuedNotStarted) as never
    )
    vi.mocked(accountImports.startAccountImport).mockRejectedValue(
      new ApiRequestError('Too many imports started recently', 429, 3_600_000)
    )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      screen.getByText('Too many imports started recently')
    ).toBeInTheDocument()

    chooseFile('other.zip')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
    })
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(screen.queryByText('Import cancelled')).not.toBeInTheDocument()
    expect(screen.getByLabelText('File')).toBeInTheDocument()
  })

  it.each([
    ['a 503', new ApiRequestError('Import storage is unavailable', 503)],
    ['a network error', new TypeError('Failed to fetch')]
  ])(
    'hands a kept upload to the warning when a start fails with %s and another file is chosen',
    async (_label, failure) => {
      vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
        failure
      )
      renderSection()
      chooseFile('a.zip')
      submitArchive()

      expect(
        await screen.findByText('Could not start the import')
      ).toBeInTheDocument()
      expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()

      chooseFile('b.zip')

      // The kept upload is still queued on the server, and the warning says
      // so straight away: the row must not live only in the form's state,
      // which another file resets.
      expect(
        await screen.findByText('An earlier upload was not started')
      ).toBeInTheDocument()
      expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
      expect(
        screen.getByText('Start or discard the earlier upload first')
      ).toBeInTheDocument()
    }
  )

  it('keeps the warning when a .csv is chosen after a kept start failure', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 60_000)
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()

    // A .csv swaps the archive form for the CSV form; the warning must not
    // go with it.
    chooseFile('following_accounts.csv')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import following' })
      ).toBeInTheDocument()
    )
    expect(
      screen.getByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start import' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('does not cancel the upload when the form is swapped out while the start is in flight', async () => {
    // The start inspects the archive on the server and can take seconds; the
    // mockup promises the import carries on without the page.
    vi.mocked(accountImports.startAccountImport).mockImplementation(
      () => new Promise(() => {})
    )

    renderSection()
    chooseFile('a.zip')
    submitArchive()

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalled()
    )
    chooseFile('following_accounts.csv')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import following' })
      ).toBeInTheDocument()
    )

    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('moves focus to the report after cancelling an import', async () => {
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'cancelled',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)
    renderWithImport(activeImport)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )

    await waitFor(() =>
      expect(screen.getByText('Import cancelled')).toBeInTheDocument()
    )
    // The dialog returns focus to the Cancel import button, which unmounts
    // with the progress view; the report must take the focus itself.
    const reportAlert = screen
      .getByText('Import cancelled')
      .closest('[data-slot="alert"]')
    await waitFor(() => {
      expect(document.activeElement).toBe(reportAlert?.parentElement)
    })
  })

  it('does not carry a failed cancel over to the next import', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(accountImports.cancelAccountImport)
      .mockRejectedValueOnce(new ApiRequestError('Server error', 500))
      .mockResolvedValue({} as never)
    vi.mocked(accountImports.getAccountImport)
      .mockResolvedValueOnce(finishedImport as never)
      .mockResolvedValue({ ...activeImport, id: 'archive-2' } as never)
    renderWithImport(activeImport)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )
    expect(
      await screen.findByText('Could not cancel the import')
    ).toBeInTheDocument()

    // The import finishes on its own and the report replaces the progress.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(await screen.findByText('Import finished')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import another file' }))

    // A new import is uploaded and started.
    vi.mocked(accountImports.createPresignedImport).mockResolvedValue({
      ...queuedNotStarted,
      id: 'archive-2',
      uploadUrl: 'https://storage.example/upload',
      directUploadPath: null
    } as never)
    vi.mocked(accountImports.startAccountImport).mockResolvedValue({
      ...activeImport,
      id: 'archive-2'
    } as never)
    chooseFile('b.zip')
    submitArchive()

    expect(await screen.findByText('Import in progress')).toBeInTheDocument()
    // The failure belonged to the import it happened on, never to this one.
    expect(
      screen.queryByText('Could not cancel the import')
    ).not.toBeInTheDocument()
  })

  it('hands a kept upload to the warning when another file is chosen after a 429', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Too many imports started recently', 429, 60_000)
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()

    chooseFile('b.zip')

    expect(
      await screen.findByText('An earlier upload was not started')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start or discard the earlier upload first')
    ).toBeInTheDocument()
  })

  it('starts a kept upload with the switches as they stand while the same file is chosen', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
      .mockResolvedValueOnce(activeImport)
    renderSection()
    chooseFile('a.zip')
    fireEvent.click(screen.getByRole('switch', { name: 'Import likes' }))
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Replace my profile with the one in the archive'
      })
    )
    submitArchive()

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()

    // a.zip is still the chosen file, so its switches are live: Try again
    // must send what they show now, not what they showed at the 429.
    fireEvent.click(screen.getByRole('switch', { name: 'Import bookmarks' }))
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Replace my profile with the one in the archive'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(
      vi.mocked(accountImports.startAccountImport).mock.calls[1][0].options
    ).toMatchObject({ likes: true, bookmarks: true, profile: false })
  })

  it('locks the switches while the upload and the start are in flight', async () => {
    let finishUpload: () => void = () => undefined
    vi.mocked(accountImports.uploadAccountImport).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishUpload = resolve
        })
    )
    let rejectStart: (error: unknown) => void = () => undefined
    vi.mocked(accountImports.startAccountImport).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject
        })
    )
    const switchLabels = [
      "Import replies to other people's posts",
      'Import likes',
      'Import bookmarks',
      'Replace my profile with the one in the archive',
      'Replace my settings with the ones in the archive'
    ]
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    expect(await screen.findByText('Uploading the archive')).toBeInTheDocument()
    switchLabels.forEach((label) =>
      expect(screen.getByRole('switch', { name: label })).toBeDisabled()
    )

    await act(async () => {
      finishUpload()
    })
    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(1)
    )
    // The start is in flight: the switches stay locked, so what is sent
    // is what is shown.
    switchLabels.forEach((label) =>
      expect(screen.getByRole('switch', { name: label })).toBeDisabled()
    )

    await act(async () => {
      rejectStart(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
    })
    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()
    switchLabels.forEach((label) =>
      expect(screen.getByRole('switch', { name: label })).toBeEnabled()
    )
  })

  it('cancels the row and shows File is too large when start answers 413', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('File is too large', 413)
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    expect(
      await screen.findByText('Choose a file no larger than 1.0 MB.')
    ).toBeInTheDocument()
    expect(screen.getByText('File is too large')).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('An earlier upload was not started')
    ).not.toBeInTheDocument()
  })

  it('moves focus into the progress view after a start succeeds', async () => {
    renderSection()
    chooseFile('archive.zip')
    submitArchive()

    expect(await screen.findByText('Import in progress')).toBeInTheDocument()
    // The form that held the focused button unmounts, so the progress view
    // takes the focus itself and the live region is announced.
    const heading = screen.getByText('Import in progress')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading.parentElement)
      expect(document.activeElement).toHaveAttribute('tabindex', '-1')
    })
  })

  it('moves focus to the file picker after Discard', async () => {
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(
        screen.queryByText('An earlier upload was not started')
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  it.each([
    [
      'an unreadable archive',
      new ApiRequestError('Archive format is not recognised', 422),
      'We could not read this file'
    ],
    [
      'an incomplete upload',
      new ApiRequestError('Upload is incomplete; upload it again', 409),
      'The upload did not finish'
    ],
    [
      'a too-large file',
      new ApiRequestError('File is too large', 413),
      'File is too large'
    ]
  ])(
    'moves focus to the file picker when a start from the warning drops the upload (%s)',
    async (_label, error, title) => {
      vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(error)
      renderWithImport(queuedNotStarted)

      const start = screen.getByRole('button', { name: 'Start import' })
      start.focus()
      fireEvent.click(start)

      expect(await screen.findByText(title)).toBeInTheDocument()
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('button', { name: 'Choose file' })
        )
      )
    }
  )

  it('moves focus to the file picker when a start finds the upload was discarded elsewhere', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is not queued', 409)
    )
    vi.mocked(accountImports.getAccountImport).mockResolvedValueOnce(
      cancelledNotStarted as never
    )
    renderWithImport(queuedNotStarted)

    const start = screen.getByRole('button', { name: 'Start import' })
    start.focus()
    fireEvent.click(start)

    expect(
      await screen.findByText('The upload did not finish')
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  it('keeps the focus on the warning when Try again on the rate-limit alert is refused again', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
      .mockRejectedValueOnce(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()

    // The click clears the alert at once, so the focused Try again
    // unmounts before any answer comes back.
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    tryAgain.focus()
    fireEvent.click(tryAgain)
    await waitFor(() =>
      expect(
        screen.queryByText('Too many imports started recently')
      ).not.toBeInTheDocument()
    )

    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()
    // The alert came back with the warning's buttons enabled, so the
    // warning's Start import must have taken the focus the unmounted Try
    // again dropped.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Start import' })
      )
    )
  })

  it('keeps the focus on the warning when Retry on the generic alert fails again', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    expect(
      await screen.findByText('Could not start the import')
    ).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Retry' })
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() =>
      expect(
        screen.queryByText('Could not start the import')
      ).not.toBeInTheDocument()
    )

    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Start import' })
      )
    )
  })

  it('moves focus to the file picker when Try again on the rate-limit alert drops the upload', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      )
      .mockRejectedValueOnce(
        new ApiRequestError('Archive format is not recognised', 422)
      )
    renderWithImport(queuedNotStarted)

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
    expect(
      await screen.findByText('Too many imports started recently')
    ).toBeInTheDocument()

    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    tryAgain.focus()
    fireEvent.click(tryAgain)

    expect(
      await screen.findByText('We could not read this file')
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  it('starts a kept upload with the options it was uploaded with, not the switches a later file shows', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockResolvedValueOnce(activeImport)
    renderSection()
    chooseFile('a.zip')
    fireEvent.click(screen.getByRole('switch', { name: 'Import likes' }))
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Replace my profile with the one in the archive'
      })
    )
    submitArchive()

    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()
    expect(
      vi.mocked(accountImports.startAccountImport).mock.calls[0][0].options
    ).toMatchObject({ likes: true, profile: true })

    // A .csv swaps the switches for the CSV form; the kept upload must
    // still start with the options it was uploaded with.
    chooseFile('following_accounts.csv')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import following' })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    expect(
      vi.mocked(accountImports.startAccountImport).mock.calls[1][0].options
    ).toMatchObject({ likes: true, profile: true })
  })

  it('starts a waiting upload found through a presign 409 with the default options', async () => {
    vi.mocked(accountImports.createPresignedImport).mockRejectedValueOnce(
      new ApiRequestError('An import is already active', 409)
    )
    vi.mocked(accountImports.listAccountImports).mockResolvedValue([
      { ...queuedNotStarted, id: 'other-upload' } as never
    ])
    renderSection()
    chooseFile('mine.zip')
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Replace my profile with the one in the archive'
      })
    )
    submitArchive()

    expect(
      await screen.findByText('An earlier upload was not started')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalled()
    )
    expect(
      vi.mocked(accountImports.startAccountImport).mock.calls[0][0]
    ).toEqual({
      actorId,
      importId: 'other-upload',
      options: {
        likes: false,
        bookmarks: false,
        repliesToOthers: 'skip',
        profile: false,
        settings: false
      }
    })
  })

  it('starts a waiting upload found through a start 409 with the default options', async () => {
    vi.mocked(accountImports.startAccountImport)
      .mockRejectedValueOnce(
        new ApiRequestError('Import storage is unavailable', 503)
      )
      .mockRejectedValueOnce(
        new ApiRequestError('An import is already active', 409)
      )
    vi.mocked(accountImports.listAccountImports).mockResolvedValue([
      { ...queuedNotStarted, id: 'other-upload' } as never
    ])
    renderSection()
    chooseFile('a.zip')
    fireEvent.click(screen.getByRole('switch', { name: 'Import likes' }))
    submitArchive()

    expect(
      await screen.findByText('Import storage is unavailable')
    ).toBeInTheDocument()
    // Another file is picked over the kept upload, so its switches are
    // snapshotted onto it.
    chooseFile('b.zip')
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    // That start answers 409 already active and the section finds another
    // waiting row, which must not inherit the first row's snapshot. The
    // warning is already up for the first row, so wait for the start to
    // settle before pressing the new row's Start import.
    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(2)
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start import' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }))

    await waitFor(() =>
      expect(accountImports.startAccountImport).toHaveBeenCalledTimes(3)
    )
    expect(
      vi.mocked(accountImports.startAccountImport).mock.calls[2][0]
    ).toEqual({
      actorId,
      importId: 'other-upload',
      options: {
        likes: false,
        bookmarks: false,
        repliesToOthers: 'skip',
        profile: false,
        settings: false
      }
    })
  })

  it('shows the generic start alert for a fresh upload whose re-read fails, without Retry', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Import is not queued', 409)
    )
    vi.mocked(accountImports.getAccountImport).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )
    renderSection()
    chooseFile('a.zip')
    submitArchive()

    await waitFor(() =>
      expect(accountImports.getAccountImport).toHaveBeenCalled()
    )
    expect(
      screen.getAllByText('Could not start the import').length
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
    expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
  })

  it('leaves focus on the body when a page-load import finishes that nobody touched', async () => {
    vi.useFakeTimers()
    vi.mocked(accountImports.getAccountImport).mockResolvedValue(
      finishedImport as never
    )
    renderWithImport(activeImport)
    expect(document.activeElement).toBe(document.body)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the file picker after Import another file on a finished report', async () => {
    renderWithImport(finishedImport)
    const button = screen.getByRole('button', { name: 'Import another file' })
    button.focus()
    fireEvent.click(button)

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  it('moves focus to the file picker after Start again on a failed report', async () => {
    renderWithImport(failedImport)
    const button = screen.getByRole('button', { name: 'Start again' })
    button.focus()
    fireEvent.click(button)

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  it('moves focus to the file picker after Import another file on a finished CSV import', async () => {
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(
      finishedBulkImport
    )
    vi.mocked(bulkImports.getBulkImport).mockResolvedValue(finishedBulkImport)
    renderSection()
    chooseFile('following_accounts.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    const reset = await screen.findByRole('button', {
      name: 'Import another file'
    })
    reset.focus()
    fireEvent.click(reset)

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Choose file' })
      )
    )
  })

  // The cancel rule as a table: the client cancels an account import only
  // when the user presses Discard or Cancel, when the upload itself failed
  // or was aborted, or when the start answers that the stored file can never
  // start. Every other start outcome leaves the queued upload alone. The
  // user-action side of the rule (Discard, an aborted upload, another file,
  // unmounting) is pinned by the named tests above.
  describe('cancel rule', () => {
    beforeEach(() => {
      vi.mocked(accountImports.getAccountImport).mockResolvedValue(activeImport)
    })

    it.each([
      [
        'a 429 rate limit',
        'kept',
        new ApiRequestError('Too many imports started recently', 429, 60_000)
      ],
      [
        'a 503',
        'kept',
        new ApiRequestError('Import storage is unavailable', 503)
      ],
      [
        'a network error',
        'kept',
        new ApiRequestError('The network was interrupted', 0)
      ],
      [
        'a 409 already active',
        'kept',
        new ApiRequestError('An import is already active', 409)
      ],
      [
        'a 409 not queued',
        'kept',
        new ApiRequestError('Import is not queued', 409)
      ],
      [
        'a 409 upload incomplete',
        'cancelled',
        new ApiRequestError('Upload is incomplete; upload it again', 409)
      ],
      [
        'a 409 archive changed',
        'cancelled',
        new ApiRequestError('Archive changed; upload it again', 409)
      ],
      [
        'a 422 unrecognised archive',
        'cancelled',
        new ApiRequestError('Archive format is not recognised', 422)
      ],
      [
        'a 413 too large',
        'cancelled',
        new ApiRequestError('File is too large', 413)
      ],
      [
        'another 422',
        'kept',
        new ApiRequestError('This account is being deleted', 422)
      ],
      [
        'a 500',
        'kept',
        new ApiRequestError('Import storage is unavailable', 500)
      ]
    ])(
      'start fails with %s: the stored import is %s',
      async (_label, outcome, error) => {
        vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
          error
        )

        renderSection()
        chooseFile('archive.zip')
        submitArchive()

        await waitFor(() =>
          expect(accountImports.startAccountImport).toHaveBeenCalledTimes(1)
        )
        await act(async () => {
          for (let i = 0; i < 5; i += 1) await Promise.resolve()
        })

        if (outcome === 'cancelled') {
          expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
            actorId,
            id: 'archive-1'
          })
        } else {
          expect(accountImports.cancelAccountImport).not.toHaveBeenCalled()
        }
      }
    )
  })
})
