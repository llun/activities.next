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

const chooseFile = (name: string) => {
  const file = new File(['file data'], name)
  fireEvent.change(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    { target: { files: [file] } }
  )
  return file
}

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
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

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

  it('shows the unreadable-file alert and cancels after start returns 422', async () => {
    vi.mocked(accountImports.startAccountImport).mockRejectedValueOnce(
      new ApiRequestError('Archive format is not recognised', 422)
    )
    renderSection()
    chooseFile('photos.zip')
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

    expect(
      await screen.findByText('We could not read this file')
    ).toBeInTheDocument()
    expect(accountImports.cancelAccountImport).toHaveBeenCalledWith({
      actorId,
      id: 'archive-1'
    })
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
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Import archive' }))

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
    render(
      <ImportSection
        actorId={actorId}
        handle="@may@llun.test"
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        initialImport={
          {
            ...activeImport,
            status: 'queued' as const,
            kind: null,
            phase: null,
            startedAt: null
          } as never
        }
        maxImportBytes={1024 * 1024}
        maxCsvBytes={5 * 1024 * 1024}
      />
    )

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

  it('discards a queued upload that never started', async () => {
    render(
      <ImportSection
        actorId={actorId}
        handle="@may@llun.test"
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        initialImport={
          {
            ...activeImport,
            status: 'queued' as const,
            kind: null,
            phase: null,
            startedAt: null
          } as never
        }
        maxImportBytes={1024 * 1024}
        maxCsvBytes={5 * 1024 * 1024}
      />
    )

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

  it('cancels a running import through the confirm dialog and shows the report', async () => {
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'cancelled',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)
    render(
      <ImportSection
        actorId={actorId}
        handle="@may@llun.test"
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        initialImport={activeImport}
        maxImportBytes={1024 * 1024}
        maxCsvBytes={5 * 1024 * 1024}
      />
    )

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
    vi.mocked(accountImports.getAccountImport).mockResolvedValue({
      ...activeImport,
      status: 'done',
      finishedAt: '2026-10-28T10:05:00.000Z'
    } as never)
    render(
      <ImportSection
        actorId={actorId}
        handle="@may@llun.test"
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        initialImport={activeImport}
        maxImportBytes={1024 * 1024}
        maxCsvBytes={5 * 1024 * 1024}
      />
    )
    expect(screen.getByText('Import in progress')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(screen.queryByText('Import in progress')).not.toBeInTheDocument()
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
    render(
      <ImportSection
        actorId={actorId}
        handle="@may@llun.test"
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        initialImport={activeImport}
        maxImportBytes={1024 * 1024}
        maxCsvBytes={5 * 1024 * 1024}
      />
    )

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
})
