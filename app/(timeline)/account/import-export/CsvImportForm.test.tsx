/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as bulkImports from '@/lib/client/bulkImports'
import type { BulkImportResponse } from '@/lib/client/bulkImports'
import { ApiRequestError } from '@/lib/client/http'
import { formatBytes } from '@/lib/utils/formatBytes'

import { CsvImportForm } from './CsvImportForm'

const mocks = vi.hoisted(() => ({
  restored: null as (() => void) | null
}))

vi.mock('@/lib/client/bulkImports', () => ({
  createBulkImport: vi.fn(),
  getBulkImport: vi.fn()
}))
vi.mock('@/lib/client/connection', () => ({
  onConnectionRestored: (listener: () => void) => {
    mocks.restored = listener
    return () => {
      mocks.restored = null
    }
  }
}))

const actorId = 'https://llun.test/users/may'

const connectionState = { offline: false }

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({
    state: connectionState.offline ? 'offline' : 'online'
  })
}))

const bulkImport = (
  overrides: Partial<BulkImportResponse>
): BulkImportResponse => ({
  id: 'bulk-1',
  type: 'following',
  mode: 'merge',
  state: 'in_progress',
  originalFilename: 'following_accounts.csv',
  totalItems: 5,
  processedItems: 0,
  importedItems: 0,
  failedItems: 0,
  createdAt: '2026-10-28T10:00:00.000Z',
  finishedAt: null,
  ...overrides
})

const csvFile = () => new File(['account,acct'], 'following_accounts.csv')

const filePickerRef = { current: null } as {
  current: HTMLButtonElement | null
}

const csvElement = (
  file: File,
  onActorChanged: () => void,
  onMoved: () => void,
  handlers?: {
    onFileChange?: (file: File | null) => void
    onImportAnotherFile?: () => void
    onBusyChange?: (busy: boolean) => void
  }
) => (
  <CsvImportForm
    actorId={actorId}
    file={file}
    maxCsvBytes={5 * 1024 * 1024}
    filePickerRef={filePickerRef}
    onFileChange={handlers?.onFileChange ?? vi.fn()}
    onImportAnotherFile={handlers?.onImportAnotherFile ?? vi.fn()}
    onBusyChange={handlers?.onBusyChange ?? vi.fn()}
    onActorChanged={onActorChanged}
    onMoved={onMoved}
  />
)

const flush = async (ticks = 10) => {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve()
}

describe('CsvImportForm', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    connectionState.offline = false
    mocks.restored = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  beforeEach(() => {
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(bulkImport({}))
    vi.mocked(bulkImports.getBulkImport).mockResolvedValue(
      bulkImport({ state: 'finished' })
    )
  })

  it('uses the same Merge and Overwrite copy for every CSV type', () => {
    const copies: string[] = []
    const types = [
      'following',
      'blocking',
      'muting',
      'domain_blocking',
      'bookmarks',
      'lists'
    ]

    for (const type of types) {
      const { unmount } = render(csvElement(csvFile(), vi.fn(), vi.fn()))
      fireEvent.change(screen.getByLabelText('What is in this file'), {
        target: { value: type }
      })
      fireEvent.click(screen.getByRole('radio', { name: /Overwrite/ }))
      const group = screen.getByRole('radiogroup', {
        name: 'When importing'
      }).textContent
      const warning = screen
        .getByText('Overwrite replaces your current list')
        .closest('[data-slot="alert"]')!.textContent
      copies.push(`${group}|${warning}`)
      unmount()
    }

    expect(copies.every((copy) => copy === copies[0])).toBe(true)
    expect(copies[0]).toContain('Keep what you have and add the file.')
    expect(copies[0]).toContain('Replace what you have with the file.')
    expect(copies[0]).toContain('Overwrite replaces your current list')
    expect(copies[0]).toContain('Anything not in the file is removed.')
  })

  it('submits, polls every three seconds and shows the finished counts and failed rows', async () => {
    vi.useFakeTimers()
    vi.mocked(bulkImports.getBulkImport)
      .mockResolvedValueOnce(
        bulkImport({ processedItems: 2, importedItems: 1, failedItems: 1 })
      )
      .mockResolvedValueOnce(
        bulkImport({
          state: 'finished',
          processedItems: 5,
          importedItems: 3,
          failedItems: 2,
          finishedAt: '2026-10-28T10:01:00.000Z',
          failedRows: [
            { rowIndex: 4, data: {}, error: 'Account not found' },
            { rowIndex: 9, data: {}, error: 'Could not follow' }
          ]
        })
      )

    render(csvElement(csvFile(), vi.fn(), vi.fn()))
    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))
    await act(async () => {
      await flush()
    })

    expect(screen.getByText('Importing')).toBeInTheDocument()
    expect(bulkImports.createBulkImport).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(bulkImports.getBulkImport).toHaveBeenCalledTimes(1)
    expect(screen.getByText('1 imported · 1 failed')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(bulkImports.getBulkImport).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(screen.getByText('3 imported · 2 failed')).toBeInTheDocument()
    expect(screen.getByText('Row 4:')).toBeInTheDocument()
    expect(screen.getByText('Account not found')).toBeInTheDocument()
    expect(screen.getByText('Row 9:')).toBeInTheDocument()
    expect(screen.getByText('Could not follow')).toBeInTheDocument()
  })

  it('lists at most 100 failed rows', async () => {
    const finished = bulkImport({
      state: 'finished',
      processedItems: 105,
      importedItems: 0,
      failedItems: 105,
      finishedAt: '2026-10-28T10:01:00.000Z',
      failedRows: Array.from({ length: 105 }, (_, index) => ({
        rowIndex: index + 1,
        data: {},
        error: 'Could not import this row'
      }))
    })
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(finished)
    vi.mocked(bulkImports.getBulkImport).mockResolvedValue(finished)

    render(csvElement(csvFile(), vi.fn(), vi.fn()))
    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    expect(await screen.findByText('Import finished')).toBeInTheDocument()
    expect(screen.getAllByText(/Row \d+:/)).toHaveLength(100)
  })

  it('pauses polling while offline and resumes when the connection is restored', async () => {
    vi.useFakeTimers()
    vi.mocked(bulkImports.getBulkImport).mockResolvedValue(
      bulkImport({ processedItems: 1, importedItems: 1, failedItems: 0 })
    )
    const file = csvFile()
    const onActorChanged = vi.fn()
    const onMoved = vi.fn()
    const { rerender } = render(csvElement(file, onActorChanged, onMoved))
    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))
    await act(async () => {
      await flush()
    })
    expect(screen.getByText('Importing')).toBeInTheDocument()

    connectionState.offline = true
    rerender(csvElement(file, onActorChanged, onMoved))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(bulkImports.getBulkImport).not.toHaveBeenCalled()

    connectionState.offline = false
    rerender(csvElement(file, onActorChanged, onMoved))
    await act(async () => {
      mocks.restored?.()
      await flush()
    })
    expect(bulkImports.getBulkImport).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(bulkImports.getBulkImport).toHaveBeenCalledTimes(2)
  })

  it('announces the CSV status and counts in a live region that excludes the bar', async () => {
    vi.useFakeTimers()
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(
      bulkImport({ processedItems: 2, importedItems: 1, failedItems: 1 })
    )
    render(csvElement(csvFile(), vi.fn(), vi.fn()))
    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))
    await act(async () => {
      await flush()
    })

    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Importing')
    expect(region).toHaveTextContent('1 imported · 1 failed')
    expect(region).not.toContainElement(screen.getByRole('progressbar'))
  })

  it('labels the visible file field, not the hidden input', () => {
    render(csvElement(csvFile(), vi.fn(), vi.fn()))

    const field = screen.getByLabelText('File')
    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveValue(
      `following_accounts.csv · ${formatBytes(csvFile().size)}`
    )
    expect(field.getAttribute('aria-describedby')).toContain('hint')
    expect(
      document.querySelector<HTMLInputElement>('input[type="file"]')!.id
    ).toBe('')
  })

  it('reports a 409 Actor changed instead of showing a raw error', async () => {
    const onActorChanged = vi.fn()
    vi.mocked(bulkImports.createBulkImport).mockRejectedValueOnce(
      new ApiRequestError('Actor changed', 409)
    )
    render(csvElement(csvFile(), onActorChanged, vi.fn()))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    await waitFor(() => expect(onActorChanged).toHaveBeenCalledOnce())
    expect(
      screen.queryByText('Could not start the import')
    ).not.toBeInTheDocument()
  })

  it('reports a 422 moved account', async () => {
    const onMoved = vi.fn()
    vi.mocked(bulkImports.createBulkImport).mockRejectedValueOnce(
      new ApiRequestError('This account has moved', 422)
    )
    render(csvElement(csvFile(), vi.fn(), onMoved))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce())
  })

  it('shows the plain fallback when the network fails', async () => {
    vi.mocked(bulkImports.createBulkImport).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )
    render(csvElement(csvFile(), vi.fn(), vi.fn()))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    expect(
      await screen.findByText('Could not start the import')
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('disables the Retry while offline', async () => {
    let rejectCreate: (error: unknown) => void = () => undefined
    vi.mocked(bulkImports.createBulkImport).mockImplementationOnce(
      () =>
        new Promise<BulkImportResponse>((_resolve, reject) => {
          rejectCreate = reject
        })
    )
    render(csvElement(csvFile(), vi.fn(), vi.fn()))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    // The connection drops while the import is being sent, so the Retry
    // that appears with its failure can only be a silent no-op.
    connectionState.offline = true
    await act(async () => {
      rejectCreate(new TypeError('Failed to fetch'))
    })

    expect(
      await screen.findByText('Could not start the import')
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(bulkImports.createBulkImport).toHaveBeenCalledTimes(1)
  })

  it('locks the SaveBar while the CSV import runs', async () => {
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(bulkImport({}))
    render(csvElement(csvFile(), vi.fn(), vi.fn()))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))

    expect(await screen.findByText('Importing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Import following' })
    ).not.toBeInTheDocument()
  })

  it('locks the type and the mode while the import is being sent', async () => {
    let resolveCreate: (value: BulkImportResponse) => void = () => undefined
    vi.mocked(bulkImports.createBulkImport).mockImplementation(
      () =>
        new Promise<BulkImportResponse>((resolve) => {
          resolveCreate = resolve
        })
    )
    render(csvElement(csvFile(), vi.fn(), vi.fn()))

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))
    expect(
      await screen.findByRole('button', { name: 'Importing…' })
    ).toBeInTheDocument()

    // What is sent must be what is shown: neither the type nor the mode
    // may change while the request that carries them is in flight.
    expect(screen.getByLabelText('What is in this file')).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Merge/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Overwrite/ })).toBeDisabled()

    await act(async () => {
      resolveCreate(bulkImport({}))
    })
    // The controls unmount once the import is created; nothing else is
    // needed.
    await waitFor(() =>
      expect(
        screen.queryByLabelText('What is in this file')
      ).not.toBeInTheDocument()
    )
  })

  it('disables the CSV import while offline', () => {
    connectionState.offline = true
    const { container } = render(csvElement(csvFile(), vi.fn(), vi.fn()))

    expect(screen.getByText("You're offline")).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Import following' })
    ).toBeDisabled()

    // The disabled button is not the only guard: submitting the form itself
    // must not reach the server either.
    fireEvent.submit(container.querySelector('form')!)
    expect(bulkImports.createBulkImport).not.toHaveBeenCalled()
  })

  it('hands Import another file to the section instead of clearing the file itself', async () => {
    const onFileChange = vi.fn()
    const onImportAnotherFile = vi.fn()
    vi.mocked(bulkImports.createBulkImport).mockResolvedValue(
      bulkImport({
        state: 'finished',
        processedItems: 5,
        importedItems: 5,
        finishedAt: '2026-10-28T10:01:00.000Z'
      })
    )
    render(
      csvElement(csvFile(), vi.fn(), vi.fn(), {
        onFileChange,
        onImportAnotherFile
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Import following' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Import another file' })
    )

    expect(onImportAnotherFile).toHaveBeenCalledOnce()
    expect(onFileChange).not.toHaveBeenCalled()
  })
})
