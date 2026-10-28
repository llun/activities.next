/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { listDrafts } from '@/lib/client/drafts/draftsDb'
import { ApiRequestError } from '@/lib/client/http'

import { ArchiveExportSection } from './ArchiveExportSection'

const mocks = vi.hoisted(() => ({
  connectionState: 'online' as 'online' | 'offline',
  hydrated: true,
  restoreListener: null as null | (() => void),
  listArchives: vi.fn(),
  requestArchive: vi.fn(),
  listDrafts: vi.fn()
}))

class TestResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

vi.mock('@/lib/client/accountArchives', () => ({
  listAccountArchives: mocks.listArchives,
  requestAccountArchive: mocks.requestArchive
}))

vi.mock('@/lib/client/drafts/draftsDb', () => ({
  listDrafts: mocks.listDrafts
}))

vi.mock('@/lib/client/connection', () => ({
  onConnectionRestored: (listener: () => void) => {
    mocks.restoreListener = listener
    return () => {
      mocks.restoreListener = null
    }
  }
}))

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ state: mocks.connectionState })
}))

vi.mock('@/lib/hooks/useHasHydrated', () => ({
  useHasHydrated: () => mocks.hydrated
}))

const now = Date.parse('2026-10-28T12:00:00.000Z')

const archive = (
  status: 'queued' | 'running' | 'ready' | 'expired' | 'failed',
  overrides: Record<string, unknown> = {}
) => ({
  id: `archive-${status}`,
  status,
  stripExactLocations: false,
  includesDrafts: false,
  bytes: status === 'ready' ? 1024 ** 2 : null,
  createdAt:
    status === 'expired'
      ? '2026-10-20T09:00:00.000Z'
      : '2026-10-28T09:00:00.000Z',
  readyAt: status === 'ready' ? '2026-10-28T10:00:00.000Z' : null,
  expiresAt: status === 'ready' ? '2026-11-04T10:00:00.000Z' : null,
  // A reason the server really stores (reaper.ts), not the mockup's example
  // sentence: the fixture must be able to catch a body that ignores it.
  error: status === 'failed' ? 'The export stopped making progress' : null,
  downloadUrl:
    status === 'ready'
      ? '/api/v1/account/archives/archive-ready/download'
      : null,
  ...overrides
})

const props = {
  actorId: 'actor-1',
  currentTime: now,
  initialArchives: [],
  exportAvailable: true
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

describe('ArchiveExportSection', () => {
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    // Pin the clock to the fixtures' day: the component reads Date.now()
    // after hydration, so a real clock turns these fixed dates stale.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    mocks.connectionState = 'online'
    mocks.hydrated = true
    mocks.restoreListener = null
    mocks.listArchives.mockReset().mockResolvedValue([])
    mocks.requestArchive.mockReset()
    mocks.listDrafts.mockReset().mockResolvedValue([])
  })

  it('renders the first-time state', () => {
    render(<ArchiveExportSection {...props} />)

    expect(screen.getByTestId('archive-export-form')).toBeInTheDocument()
    expect(screen.getByText('No archive yet')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Prepare archive' })
    ).toBeEnabled()
  })

  it.each(['queued', 'running'] as const)(
    'renders the %s state with indeterminate progress and no percentage',
    (status) => {
      render(
        <ArchiveExportSection
          {...props}
          initialArchives={[archive(status)] as never}
        />
      )

      expect(
        screen.getByText('Your archive is being prepared')
      ).toBeInTheDocument()
      expect(screen.getByRole('progressbar')).not.toHaveAttribute(
        'aria-valuenow'
      )
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled()
    }
  )

  it('renders a ready archive with size, expiry and download action', () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('ready')] as never}
      />
    )

    expect(
      screen.getByText('1.0 MB · made 28 Oct 2026, 09:00')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/download link expires in 7 days/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/v1/account/archives/archive-ready/download'
    )
  })

  it('announces the latest-archive status in a live region', () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('ready')] as never}
      />
    )

    // The SaveBar's cooldown reason is a polite status too; the latest
    // archive is the one that says so.
    const region = screen
      .getAllByRole('status')
      .find((element) => element.textContent?.includes('Latest archive'))
    expect(region).toHaveTextContent('Ready')
  })

  it('renders the expired state and allows another archive', () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('expired')] as never}
      />
    )

    expect(
      screen.getByText('Your last archive has expired')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Prepare archive' })
    ).toBeEnabled()
  })

  it('renders the failed state in a standalone error alert with Try again', () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('failed')] as never}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not make your archive')
    // The body says the stored reason in plain English, not the mockup's
    // example sentence.
    expect(alert).toHaveTextContent(
      'The export stopped making progress partway through.'
    )
    expect(alert).not.toHaveTextContent('packing your photos')
    expect(alert).toHaveTextContent('Your last request does not count')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(alert.closest('[data-slot="frame"]')).toBeNull()
  })

  it('falls back to a generic body when the stored reason is unknown or missing', () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('failed', { error: null })] as never}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not make your archive')
    expect(alert).toHaveTextContent('Something went wrong while making it.')
    expect(alert).toHaveTextContent('Your last request does not count')
    expect(alert).not.toHaveTextContent('packing your photos')
  })

  it('renders the unavailable state', () => {
    render(<ArchiveExportSection {...props} exportAvailable={false} />)

    expect(
      screen.getByText('Archive export is not available on this server')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare archive' })).toBeNull()
  })

  it('offers no Try again for a failed archive when export is unavailable', () => {
    render(
      <ArchiveExportSection
        {...props}
        exportAvailable={false}
        initialArchives={[archive('failed')] as never}
      />
    )

    expect(
      screen.getByText('Archive export is not available on this server')
    ).toBeInTheDocument()
    expect(
      screen.getByText('We could not make your archive')
    ).toBeInTheDocument()
    // prepareArchive returns at once without an object store, so a Try
    // again here would be a control that does nothing.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('disables Prepare for the date returned in a 429 body', async () => {
    mocks.requestArchive.mockRejectedValue(
      new ApiRequestError(
        'An archive was requested in the last 7 days',
        429,
        undefined,
        {
          nextAllowedAt: '2026-11-04T12:00:00.000Z'
        }
      )
    )
    render(<ArchiveExportSection {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Prepare archive' })
      ).toBeDisabled()
      expect(
        screen.getByText(/You can make another archive on 4 Nov 2026/)
      ).toBeInTheDocument()
    })
  })

  it('re-reads the archives when a 429 body carries no archive', async () => {
    // Another tab or device made an archive after this page loaded, and it
    // is ready now: the rate limit is the only sign of it.
    mocks.requestArchive.mockRejectedValue(
      new ApiRequestError(
        'An archive was requested in the last 7 days',
        429,
        undefined,
        {
          nextAllowedAt: '2026-11-04T12:00:00.000Z'
        }
      )
    )
    mocks.listArchives.mockResolvedValue([archive('ready')])
    render(<ArchiveExportSection {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }))

    await waitFor(() => {
      expect(
        screen.getByText(/You can make another archive on 4 Nov 2026/)
      ).toBeInTheDocument()
    })
    expect(mocks.listArchives).toHaveBeenCalledWith({ actorId: 'actor-1' })
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
    expect(screen.queryByText('No archive yet')).not.toBeInTheDocument()
  })

  it('shows the plain fallback when the network fails', async () => {
    mocks.requestArchive.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ArchiveExportSection {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }))

    expect(
      await screen.findByText('Could not prepare your archive')
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('shows one failure alert when Try again on a failed archive fails too', async () => {
    mocks.requestArchive.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('failed')] as never}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText('Could not prepare your archive')
    ).toBeInTheDocument()
    // The stored failure and the request failure share one title, so the
    // newer body replaces the older alert instead of stacking a second
    // alert with a second Try again under it.
    expect(screen.getAllByText('We could not make your archive')).toHaveLength(
      1
    )
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1)
  })

  it('hides this browser’s drafts until hydration and only reads the current actor', async () => {
    mocks.hydrated = false
    const { rerender } = render(<ArchiveExportSection {...props} />)

    expect(
      screen.queryByRole('switch', { name: 'Include drafts from this browser' })
    ).not.toBeInTheDocument()
    expect(listDrafts).not.toHaveBeenCalled()

    mocks.hydrated = true
    rerender(<ArchiveExportSection {...props} />)

    await waitFor(() => {
      expect(listDrafts).toHaveBeenCalledWith({ actorId: 'actor-1' })
      expect(
        screen.getByRole('switch', { name: 'Include drafts from this browser' })
      ).toBeInTheDocument()
    })
  })

  it('refuses to include drafts over 5 MiB', async () => {
    mocks.listDrafts.mockResolvedValue([
      { id: 'large-draft', text: 'x'.repeat(5 * 1024 * 1024 + 1) }
    ])
    render(<ArchiveExportSection {...props} />)

    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Include drafts from this browser' })
      ).toBeDisabled()
    })
    expect(screen.getByText(/over the 5 MiB export limit/)).toBeInTheDocument()
  })

  it('sends only this actor’s drafts and the selected archive options', async () => {
    const storedDrafts = [{ id: 'draft-1', text: 'unsent' }]
    mocks.listDrafts.mockResolvedValue(storedDrafts)
    mocks.requestArchive.mockResolvedValue(archive('queued'))
    render(<ArchiveExportSection {...props} />)

    const draftsSwitch = await screen.findByRole('switch', {
      name: 'Include drafts from this browser'
    })
    fireEvent.click(draftsSwitch)
    fireEvent.click(
      screen.getByRole('switch', { name: 'Leave out exact photo locations' })
    )
    fireEvent.submit(screen.getByTestId('archive-export-form'))

    await waitFor(() => {
      expect(mocks.requestArchive).toHaveBeenCalledWith({
        actorId: 'actor-1',
        stripExactLocations: true,
        drafts: storedDrafts
      })
    })
  })

  it('locks the switches while the archive is being requested', async () => {
    // The request can carry up to 5 MiB of drafts, so it can be in flight
    // for a while: what it was sent with is what the switches must show,
    // so they are locked for as long as it runs.
    mocks.listDrafts.mockResolvedValue([{ id: 'draft-1', text: 'unsent' }])
    const pending = deferred<unknown>()
    mocks.requestArchive.mockReturnValueOnce(pending.promise)
    render(<ArchiveExportSection {...props} />)

    const draftsSwitch = await screen.findByRole('switch', {
      name: 'Include drafts from this browser'
    })
    const stripSwitch = screen.getByRole('switch', {
      name: 'Leave out exact photo locations'
    })
    expect(draftsSwitch).toBeEnabled()
    expect(stripSwitch).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }))
    await screen.findByRole('button', { name: 'Preparing…' })

    expect(draftsSwitch).toBeDisabled()
    expect(stripSwitch).toBeDisabled()
  })

  it('shows the options of the archive being made', async () => {
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={
          [
            archive('queued', {
              stripExactLocations: true,
              includesDrafts: true
            })
          ] as never
        }
      />
    )

    const stripSwitch = screen.getByRole('switch', {
      name: 'Leave out exact photo locations'
    })
    expect(stripSwitch).toBeDisabled()
    expect(stripSwitch).toHaveAttribute('aria-checked', 'true')

    const draftsSwitch = await screen.findByRole('switch', {
      name: 'Include drafts from this browser'
    })
    expect(draftsSwitch).toBeDisabled()
    expect(draftsSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('polls every 10 seconds while queued', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.listArchives.mockResolvedValue([archive('running')])
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('queued')] as never}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999)
    })
    expect(mocks.listArchives).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.listArchives).toHaveBeenCalledTimes(1)
    expect(mocks.listArchives).toHaveBeenCalledWith({ actorId: 'actor-1' })
  })

  it('pauses polling offline and refreshes on connection restoration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.connectionState = 'offline'
    mocks.listArchives.mockResolvedValue([archive('running')])
    const { rerender } = render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('queued')] as never}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(mocks.listArchives).not.toHaveBeenCalled()

    await act(async () => {
      mocks.restoreListener?.()
      await Promise.resolve()
    })
    expect(mocks.listArchives).toHaveBeenCalledTimes(1)

    mocks.connectionState = 'online'
    rerender(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('queued')] as never}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mocks.listArchives).toHaveBeenCalledTimes(2)
  })

  it('stops polling and disables Prepare after a 409 Actor changed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.listArchives.mockRejectedValue(
      new ApiRequestError('Actor changed', 409)
    )
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('queued')] as never}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mocks.listArchives).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText('Your active profile changed')
    ).toBeInTheDocument()

    // Every further request would answer the same 409, so neither the
    // interval nor a restored connection may send one.
    expect(mocks.restoreListener).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(mocks.listArchives).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled()
  })

  it('disables the failed archive’s Try again after a 409 Actor changed', async () => {
    mocks.requestArchive.mockRejectedValueOnce(
      new ApiRequestError('Actor changed', 409)
    )
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('failed')] as never}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText('Your active profile changed')
    ).toBeInTheDocument()
    // Every further request would answer the same 409, so the Try again
    // that stayed beside the alert must not offer one.
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    fireEvent.click(tryAgain)
    expect(mocks.requestArchive).toHaveBeenCalledTimes(1)
  })

  it('disables Prepare with the offline reason while offline', () => {
    mocks.connectionState = 'offline'
    render(<ArchiveExportSection {...props} />)

    const button = screen.getByRole('button', { name: 'Prepare archive' })
    expect(button).toBeDisabled()
    expect(button.closest('[data-slot="save-bar"]')).not.toBeNull()
    expect(screen.getByText("You're offline")).toBeInTheDocument()
    expect(screen.queryByText('You’re offline')).not.toBeInTheDocument()
  })

  it('disables the failed archive’s Try again while offline', () => {
    mocks.connectionState = 'offline'
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('failed')] as never}
      />
    )

    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    fireEvent.click(tryAgain)
    expect(mocks.requestArchive).not.toHaveBeenCalled()
  })

  it('disables the request failure’s Try again while offline', async () => {
    mocks.requestArchive.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { rerender } = render(<ArchiveExportSection {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }))
    expect(
      await screen.findByText('Could not prepare your archive')
    ).toBeInTheDocument()

    // The connection drops after the request failed: the Try again that
    // came with the failure can only be a silent no-op now.
    mocks.connectionState = 'offline'
    rerender(<ArchiveExportSection {...props} />)

    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    fireEvent.click(tryAgain)
    expect(mocks.requestArchive).toHaveBeenCalledTimes(1)
  })

  it('turns a ready archive into expired when its download link expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.setSystemTime(now)
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={
          [archive('ready', { expiresAt: '2026-10-28T12:01:00.000Z' })] as never
        }
      />
    )

    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()

    // A ready archive is not polled, so only the clock's own timer can turn
    // it into expired.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })

    expect(
      screen.getByText('Your last archive has expired')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Download' })
    ).not.toBeInTheDocument()
  })

  it('formats the archive dates with date-fns, not Intl', () => {
    // The house rule: a value rendered before hydration must come from a
    // formatter that is identical in every engine. Intl with a fixed locale
    // is not that formatter; date-fns on a UTCDate is.
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat')
    render(
      <ArchiveExportSection
        {...props}
        initialArchives={[archive('ready')] as never}
      />
    )

    expect(
      screen.getByText('1.0 MB · made 28 Oct 2026, 09:00')
    ).toBeInTheDocument()
    expect(dateTimeFormat).not.toHaveBeenCalled()
  })
})
