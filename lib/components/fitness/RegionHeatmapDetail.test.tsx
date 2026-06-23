/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import { PickerRegion } from '@/lib/components/fitness/HeatmapRegionPicker'

import { RegionHeatmapDetail } from './RegionHeatmapDetail'

// The real route map mounts a GL map; stub it so the detail test stays focused
// on the page chrome (header, empty state, generation tasks).
vi.mock('@/lib/components/fitness/RouteHeatmapMap', () => ({
  RouteHeatmapMap: () => <div data-testid="route-map" />
}))

const worldRegion: PickerRegion = { id: 'world', type: 'world' }
const rectRegion: PickerRegion = {
  id: 'r1',
  type: 'rect',
  name: 'Veluwe loop',
  nw: { lat: 52.6, lng: 5.6 },
  se: { lat: 52, lng: 6.2 }
}

const TEST_NOW = 1_700_000_000_000

const completedHeatmap: FitnessRouteHeatmapData = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [
    {
      points: [
        { lat: 52, lng: 5.6 },
        { lat: 52.6, lng: 6.2 }
      ]
    }
  ],
  activityCount: 12,
  pointCount: 340,
  totalCount: 20,
  cursorOffset: 20,
  isPartial: false,
  error: null,
  createdAt: TEST_NOW - 60_000,
  updatedAt: TEST_NOW - 30_000
}

const defaultProps = {
  region: worldRegion,
  meta: { activity: 'All activities', period: 'All time' },
  heatmap: null as FitnessRouteHeatmapData | null,
  embedOrigin: 'https://llun.test',
  isSharing: false,
  onShare: vi.fn(),
  onUnshare: vi.fn(),
  currentTime: TEST_NOW,
  isLoading: false,
  busy: false,
  pollingStalled: false,
  progressPercent: null as number | null,
  isRetrying: false,
  generationQueued: false,
  error: null as string | null,
  onBack: vi.fn(),
  onGenerate: vi.fn(),
  onRetry: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegionHeatmapDetail', () => {
  it('renders the world header and the empty state with a generate action', () => {
    const onGenerate = vi.fn()
    render(<RegionHeatmapDetail {...defaultProps} onGenerate={onGenerate} />)

    // h2 — the page-level PageHeader owns the h1.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Whole world' })
    ).toBeInTheDocument()
    expect(screen.getByText('No heatmap yet')).toBeInTheDocument()
    expect(
      screen.getByText('No generation runs yet for this region.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generate heatmap' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('renders a drawn area header with its coordinates', () => {
    render(<RegionHeatmapDetail {...defaultProps} region={rectRegion} />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Veluwe loop' })
    ).toBeInTheDocument()
    expect(screen.getByText(/TL .*N .*E/)).toBeInTheDocument()
  })

  it('renders the map, current-version line, and regenerate for a completed run', () => {
    render(<RegionHeatmapDetail {...defaultProps} heatmap={completedHeatmap} />)

    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(screen.getByText(/Current version/)).toBeInTheDocument()
    expect(screen.getByText(/12 activities · 340 points/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Regenerate/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('1 run')).toBeInTheDocument()
  })

  it('renders currentTime-derived relative times (generated / started / took)', () => {
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        currentTime={TEST_NOW}
        heatmap={{
          ...completedHeatmap,
          createdAt: TEST_NOW - 2 * 3_600_000,
          updatedAt: TEST_NOW - 3_600_000
        }}
      />
    )

    // generated = currentTime − updatedAt = 1h; started = currentTime − createdAt
    // = 2h; took = updatedAt − createdAt = 60m. All derive from currentTime, so a
    // component that called Date.now() internally would not produce these.
    expect(screen.getByText(/generated 1h ago/i)).toBeInTheDocument()
    expect(screen.getByText(/Started 2h ago · took 60m 0s/)).toBeInTheDocument()
  })

  it('surfaces the stalled state with a retry instead of a forever spinner', () => {
    const onRetry = vi.fn()
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={{
          ...completedHeatmap,
          status: 'generating',
          segments: [],
          bounds: null,
          pointCount: 0
        }}
        busy={false}
        pollingStalled
        onRetry={onRetry}
      />
    )

    // The stalled banner (role="status") carries its own Retry; the empty
    // "No heatmap yet" block is suppressed in favour of the banner.
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/taking longer than expected/i)
    expect(screen.queryByText('No heatmap yet')).not.toBeInTheDocument()

    fireEvent.click(within(banner).getByRole('button', { name: /Retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('treats a completed-but-empty run as a kept version, not "No heatmap yet"', () => {
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={{
          ...completedHeatmap,
          segments: [],
          bounds: null,
          pointCount: 0,
          activityCount: 0
        }}
      />
    )

    // The map area still renders (it shows its own "no route data" state), the
    // header offers Regenerate, and the task reads Completed — no contradiction.
    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(screen.queryByText('No heatmap yet')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Regenerate/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('shows a retry control for a failed run', () => {
    const onRetry = vi.fn()
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={{
          ...completedHeatmap,
          status: 'failed',
          error: 'Tile render timed out',
          segments: [],
          bounds: null,
          pointCount: 0
        }}
        onRetry={onRetry}
      />
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Tile render timed out')).toBeInTheDocument()
    // No completed map for a failed run.
    expect(screen.queryByTestId('route-map')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows generation progress while building', () => {
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={{
          ...completedHeatmap,
          status: 'generating',
          segments: [],
          bounds: null,
          pointCount: 0
        }}
        busy
        progressPercent={45}
      />
    )

    // The building empty state announces to screen readers (role="status").
    expect(screen.getByRole('status')).toHaveTextContent(
      'Building your heatmap…'
    )
    expect(screen.getByText('Generating… 45%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '45'
    )
  })

  it('offers a Create embed link action for a completed, unshared heatmap', () => {
    const onShare = vi.fn()
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={completedHeatmap}
        onShare={onShare}
      />
    )

    expect(screen.getByText('Share & embed')).toBeInTheDocument()
    // No snippets are shown until the heatmap is shared.
    expect(screen.queryByText('Embed (iframe)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create embed link/i }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('shows embed snippets and a stop-sharing action once shared', () => {
    const onUnshare = vi.fn()
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        heatmap={{ ...completedHeatmap, shareToken: 'tok123' }}
        onUnshare={onUnshare}
      />
    )

    const snippets = screen
      .getAllByRole('textbox')
      .map((node) => (node as HTMLTextAreaElement).value)
    expect(
      snippets.some((value) =>
        value.includes('https://llun.test/embed/heatmap/tok123"')
      )
    ).toBe(true)
    expect(
      snippets.some((value) =>
        value.includes('https://llun.test/embed/heatmap/tok123/image"')
      )
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Stop sharing/i }))
    expect(onUnshare).toHaveBeenCalledTimes(1)
  })

  it('labels the embed snippets with the region name', () => {
    render(
      <RegionHeatmapDetail
        {...defaultProps}
        region={rectRegion}
        heatmap={{ ...completedHeatmap, shareToken: 'tok123' }}
      />
    )

    const snippets = screen
      .getAllByRole('textbox')
      .map((node) => (node as HTMLTextAreaElement).value)
    expect(
      snippets.some((value) => value.includes('title="Veluwe loop"'))
    ).toBe(true)
    expect(snippets.some((value) => value.includes('alt="Veluwe loop"'))).toBe(
      true
    )
  })

  it('invokes onBack from the breadcrumb', () => {
    const onBack = vi.fn()
    render(<RegionHeatmapDetail {...defaultProps} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /All regions/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('surfaces a generation error', () => {
    render(<RegionHeatmapDetail {...defaultProps} error="queue unavailable" />)
    expect(screen.getByRole('alert')).toHaveTextContent('queue unavailable')
  })
})
