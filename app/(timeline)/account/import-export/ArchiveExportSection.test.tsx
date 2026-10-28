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
  error:
    status === 'failed'
      ? 'Something went wrong while packing your photos.'
      : null,
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

describe('ArchiveExportSection', () => {
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
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

    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Latest archive')
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
    expect(alert).toHaveTextContent(
      'Something went wrong while packing your photos'
    )
    expect(alert).toHaveTextContent('Your last request does not count')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(alert.closest('[data-slot="frame"]')).toBeNull()
  })

  it('renders the unavailable state', () => {
    render(<ArchiveExportSection {...props} exportAvailable={false} />)

    expect(
      screen.getByText('Archive export is not available on this server')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare archive' })).toBeNull()
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

  it('polls every 10 seconds while queued', async () => {
    vi.useFakeTimers()
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
})
