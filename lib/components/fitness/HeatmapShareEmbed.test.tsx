/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'

import { HeatmapShareEmbed } from './HeatmapShareEmbed'

// The live preview mounts a GL map; stub it so these tests stay focused on the
// panel chrome (tabs, sizes, snippets).
vi.mock('@/lib/components/fitness/RouteHeatmapMap', () => ({
  RouteHeatmapMap: () => <div data-testid="route-map" />
}))

const heatmap: FitnessRouteHeatmapData = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [{ points: [{ lat: 52, lng: 5.6 }] }],
  activityCount: 12,
  pointCount: 340,
  totalCount: 20,
  cursorOffset: 20,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2
}

const defaultProps = {
  shareToken: undefined as string | null | undefined,
  embedOrigin: 'https://llun.test',
  regionLabel: undefined as string | undefined,
  isWorld: true,
  heatmap,
  isSharing: false,
  onShare: vi.fn(),
  onUnshare: vi.fn()
}

const textboxValues = (): string[] =>
  screen
    .getAllByRole('textbox')
    .map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HeatmapShareEmbed', () => {
  it('renders collapsed to a single Share & embed button by default', () => {
    render(<HeatmapShareEmbed {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: /Share & embed/i })
    expect(trigger).toBeInTheDocument()
    // No tabs or snippets until the panel is opened.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('offers Create public link when opened on an unshared heatmap', () => {
    const onShare = vi.fn()
    render(<HeatmapShareEmbed {...defaultProps} onShare={onShare} />)

    fireEvent.click(screen.getByRole('button', { name: /Share & embed/i }))
    // Still no copyable snippets while unshared.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create public link/i }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('shows the three share tabs and a stop-sharing action once shared', () => {
    const onUnshare = vi.fn()
    render(
      <HeatmapShareEmbed
        {...defaultProps}
        shareToken="tok123"
        defaultOpen
        onUnshare={onUnshare}
      />
    )

    expect(screen.getByRole('tab', { name: /Embed/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Image/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Link/i })).toBeInTheDocument()

    // The active tab is wired to its panel for screen readers.
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', 'share-tab-embed')
    expect(screen.getByRole('tab', { name: /Embed/i })).toHaveAttribute(
      'aria-controls',
      'share-panel-embed'
    )

    // Default (Embed) tab shows the iframe snippet pointing at the embed route.
    expect(
      textboxValues().some((value) =>
        value.includes('https://llun.test/embed/heatmap/tok123"')
      )
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Stop sharing/i }))
    expect(onUnshare).toHaveBeenCalledTimes(1)
  })

  it('switches to the image snippet on the Image tab', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('tab', { name: /Image/i }))
    expect(
      textboxValues().some((value) =>
        value.includes('/embed/heatmap/tok123/image?w=600&h=420')
      )
    ).toBe(true)
  })

  it('points the Link tab at the public /u/heatmaps page', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('tab', { name: /Link/i }))
    expect(
      textboxValues().some(
        (value) => value === 'https://llun.test/u/heatmaps/tok123'
      )
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: /Open the public page/i })
    ).toHaveAttribute('href', 'https://llun.test/u/heatmaps/tok123')
  })

  it('updates snippet dimensions when a different size is chosen', () => {
    render(
      <HeatmapShareEmbed {...defaultProps} shareToken="tok123" defaultOpen />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect(
      textboxValues().some(
        (value) =>
          value.includes('width="800"') && value.includes('height="560"')
      )
    ).toBe(true)
  })

  it('labels and HTML-escapes the region name in snippets', () => {
    render(
      <HeatmapShareEmbed
        {...defaultProps}
        isWorld={false}
        regionLabel={'Tom & "Jerry" <loop>'}
        shareToken="tok123"
        defaultOpen
      />
    )

    const values = textboxValues()
    expect(
      values.some((value) =>
        value.includes(
          'title="Route heatmap — Tom &amp; &quot;Jerry&quot; &lt;loop&gt;"'
        )
      )
    ).toBe(true)
  })
})
