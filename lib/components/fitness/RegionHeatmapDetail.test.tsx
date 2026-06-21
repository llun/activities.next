/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

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
  currentTime: TEST_NOW,
  isLoading: false,
  busy: false,
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

    expect(
      screen.getByRole('heading', { level: 1, name: 'Whole world' })
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
      screen.getByRole('heading', { level: 1, name: 'Veluwe loop' })
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

    expect(screen.getByText('Building your heatmap…')).toBeInTheDocument()
    expect(screen.getByText('Generating… 45%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '45'
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
