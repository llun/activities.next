/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import { FitnessStatusDetail } from './FitnessStatusDetail'
import {
  buildFitnessFile,
  mockGetFitnessFilesByStatus,
  mockGetFitnessRouteData,
  openSectionMenu,
  renderDetail,
  resetFitnessStatusDetailMocks,
  routeData
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  updateFitnessFileGear: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

// The keyless GL loader never resolves here, so the interactive map stays in its
// initializing state (no real MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn(
    async (status: { id: string }) => `/@actor/${status.id}`
  )
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

// Flattened rather than driven as a real Radix menu; see MockPostMenu.
vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  it('renders the 25 W power distribution section', async () => {
    const { container } = renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: '25 W Distribution' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Power distribution' })
      ).toBeInTheDocument()
    )
    // Weighted-average power = mean(powerSeries) = 135 W.
    expect(screen.getByText(/Average Power\s*135\s*W/)).toBeInTheDocument()
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  describe('power distribution average label', () => {
    const openPowerDistribution = async () => {
      renderDetail()
      await waitFor(() =>
        expect(screen.getByText('Avg HR')).toBeInTheDocument()
      )
      const menu = await openSectionMenu()
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: '25 W Distribution' })
      )
      return screen.findByTestId('power-average-label')
    }

    it('is 12px HTML text over the plot, not SVG text that scales with the card', async () => {
      const label = await openPowerDistribution()

      // The plot's svg is stretched with preserveAspectRatio="none", so an SVG
      // <text> shrank with the card to ~8px. Outside the svg it stays fixed.
      expect(label.closest('svg')).toBeNull()
      expect(label).toHaveTextContent('Average Power 135 W')
    })

    it('flips to the left of the average line once the line is past the middle of the plot', async () => {
      // 135 W over 10 buckets of 25 W puts the line at ~54% of the plot.
      const label = await openPowerDistribution()

      expect(label.style.right).toMatch(/^calc\(\d+(\.\d+)?% \+ 6px\)$/)
      expect(label.style.left).toBe('')
    })

    it('starts just right of the average line while the line is in the left half', async () => {
      // Mostly easy riding plus one 300 W sprint: mean 71 W, line at ~18%.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        powerSeries: [40, 50, 60, 50, 40, 60, 300]
      })
      const label = await openPowerDistribution()

      expect(label.style.left).toMatch(/^calc\(\d+(\.\d+)?% \+ 6px\)$/)
      expect(label.style.right).toBe('')
    })
  })

  describe('power distribution axes', () => {
    const openPowerDistribution = async (powerSeries: number[]) => {
      mockGetFitnessRouteData.mockResolvedValue({ ...routeData, powerSeries })
      const { container } = renderDetail()
      await waitFor(() =>
        expect(screen.getByText('Avg HR')).toBeInTheDocument()
      )
      const menu = await openSectionMenu()
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: '25 W Distribution' })
      )
      await screen.findByTestId('power-average-label')
      return container
    }

    // A 300 W peak is ceil((300 + 25) / 25) = 13 buckets — an odd count, the
    // shape whose last even index (12, at 92%) sat under the end label.
    const oddBucketSeries = [40, 50, 60, 50, 40, 60, 300]

    it('prints no x tick label under the end label when the bucket count is odd', async () => {
      await openPowerDistribution(oddBucketSeries)

      expect(
        screen.getAllByTestId('power-x-tick').map((tick) => tick.textContent)
      ).toEqual(['0 W', '50 W', '100 W', '150 W', '200 W', '250 W'])
      expect(screen.getByTestId('power-x-end-label')).toHaveTextContent('325 W')
    })

    it('puts each y label on its own gridline, clamped inside the axis box', async () => {
      const container = await openPowerDistribution(oddBucketSeries)

      // The plot's horizontal gridlines, as a share of the svg's viewBox height.
      const gridlines = Array.from(
        container.querySelectorAll('svg line[x1="0"]')
      )
      const viewBoxHeight = Number(
        gridlines[0]?.closest('svg')?.getAttribute('viewBox')?.split(' ')[3]
      )
      const gridlinePercents = gridlines.map(
        (line) => (Number(line.getAttribute('y1')) / viewBoxHeight) * 100
      )
      expect(gridlinePercents).toHaveLength(5)

      // Labels read top to bottom, so the top label belongs to the highest
      // gridline (the smallest y).
      const labels = screen.getAllByTestId('power-y-tick')
      expect(labels).toHaveLength(5)
      const labelPercents = labels.map((label) =>
        Number(/^clamp\(8px, ([\d.]+)%/.exec(label.style.top)?.[1])
      )
      labelPercents.forEach((percent, index) => {
        expect(percent).toBeCloseTo(
          gridlinePercents[gridlinePercents.length - 1 - index],
          5
        )
      })
      // The gridlines are not evenly spread over the box, which is why
      // `justify-between` could not place the labels.
      expect(labelPercents[0]).toBeGreaterThan(5)
      expect(labelPercents[4]).toBe(100)
      for (const label of labels) {
        // The lower clamp keeps the baseline label inside the box. jsdom's
        // serializer drops the inner `calc(`, hence the optional group.
        expect(label.style.top).toMatch(/, (calc\()?100% - 8px\)+$/)
      }
    })
  })

  it('toggles a series off with its picker chip and keeps the rest', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

    // A picker chip appears for every available series, all selected by default.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Elevation' })
      ).toBeInTheDocument()
    )
    for (const name of ['Elevation', 'Speed', 'Power', 'Heart rate']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    // Every series is stacked by default.
    expect(
      screen.getByRole('heading', { name: 'Elevation Profile' })
    ).toBeInTheDocument()

    // Toggling a chip off drops that graph and leaves the others in place.
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(screen.getByRole('button', { name: 'Power' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(
      screen.queryByRole('heading', { name: 'Power' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Elevation Profile' })
    ).toBeInTheDocument()
  })

  describe('analysis graphs', () => {
    const openAnalysis = async (
      props: Partial<Parameters<typeof FitnessStatusDetail>[0]> = {}
    ) => {
      renderDetail(props)
      const menu = await openSectionMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))
      return screen.findByTestId('analysis-graphs')
    }

    // jsdom lays nothing out, so every chart reports a zero-size box and the
    // pointer ratio saturates at 1 wherever you "move" to — which cannot tell a
    // correct mapping from a handler that always reports the end of the
    // activity. Give the plot a real box so the offset, the division and the
    // clamp are all exercised.
    const hoverChart = (panel: HTMLElement, clientX: number) => {
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))
      elevationChart.getBoundingClientRect = () =>
        ({ left: 100, width: 400 }) as DOMRect
      fireEvent.mouseMove(elevationChart, { clientX })
      return elevationChart
    }

    it('stacks every visible graph into one panel instead of separate cards', async () => {
      const panel = await openAnalysis()

      expect(
        within(panel)
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent)
      ).toEqual(['Elevation Profile', 'Speed', 'Power', 'Heart rate'])
      // The rounding belongs to the shared panel, not to each row.
      expect(panel.querySelectorAll('.rounded-xl')).toHaveLength(0)
    })

    it('keeps the single panel when only one graph is selected', async () => {
      const panel = await openAnalysis()

      // Toggle every series off except Speed.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      fireEvent.click(screen.getByRole('button', { name: 'Power' }))
      fireEvent.click(screen.getByRole('button', { name: 'Heart rate' }))

      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(
        1
      )
      expect(
        within(panel).getByRole('heading', { name: 'Speed' })
      ).toBeInTheDocument()
    })

    it('overlays the selected series in one chart in combined mode', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))

      const combined = await screen.findByTestId('analysis-combined-graph')
      // The stacked panel is replaced by one overlaid chart titled "Combined".
      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
      expect(
        within(combined).getByRole('heading', { name: 'Combined' })
      ).toBeInTheDocument()
      expect(
        within(combined).getAllByRole('heading', { level: 3 })
      ).toHaveLength(1)
      // One line per selected series is drawn in the single plot.
      expect(combined.querySelectorAll('svg path')).toHaveLength(4)
      expect(
        within(combined).getByText('Each graph is scaled to its own range.')
      ).toBeInTheDocument()
    })

    it('drops a deselected series from the combined chart', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(combined.querySelectorAll('svg path')).toHaveLength(4)

      // Toggling Elevation off removes its overlaid line.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)
    })

    it('reads out every series at once while the combined chart is hovered', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')

      expect(
        screen.queryByTestId('combined-hover-value')
      ).not.toBeInTheDocument()

      const [plot] = Array.from(combined.querySelectorAll('svg'))
      plot.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      // A quarter of the way across => 450s of a 1800s ride.
      fireEvent.mouseMove(plot, { clientX: 200 })

      const readout = screen.getByTestId('combined-hover-value')
      // One box, with a value + unit row for every selected series.
      expect(within(readout).getAllByText(/^(m|km\/h|W|bpm)$/)).toHaveLength(4)
      expect(screen.getByText('Selected time: 7:30')).toBeInTheDocument()
      // A dot pinned to each series' own line at that instant.
      expect(screen.getAllByTestId('combined-hover-dot')).toHaveLength(4)

      fireEvent.mouseLeave(plot)
      expect(
        screen.queryByTestId('combined-hover-value')
      ).not.toBeInTheDocument()
    })

    it('shows a hint when every graph is toggled off', async () => {
      await openAnalysis()

      for (const name of ['Elevation', 'Speed', 'Power', 'Heart rate']) {
        fireEvent.click(screen.getByRole('button', { name }))
      }

      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
      expect(
        screen.getByText('Select at least one graph to display.')
      ).toBeInTheDocument()
    })

    it('keeps a deselected series out after switching display modes', async () => {
      await openAnalysis()

      // Deselect Elevation in the default separate mode.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      expect(
        screen.queryByRole('heading', { name: 'Elevation Profile' })
      ).not.toBeInTheDocument()

      // The selection is independent of the mode: switching to combined keeps
      // Elevation out, so only three of the four series overlay.
      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(screen.getByRole('button', { name: 'Elevation' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)

      // …and back again: still out in the separate stack.
      fireEvent.click(screen.getByRole('button', { name: 'Separate' }))
      const panel = await screen.findByTestId('analysis-graphs')
      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(
        3
      )
      expect(
        within(panel).queryByRole('heading', { name: 'Elevation Profile' })
      ).not.toBeInTheDocument()
    })

    it('offers no chip for a series that has no data', async () => {
      // A file with no power stream: the Power chip never appears, and the
      // combined chart overlays only the three series that do have data. This
      // guards the availability filter that replaced the removed reset effect —
      // a selected-but-absent series simply drops out, it never gets stuck.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        powerSeries: []
      })

      await openAnalysis()

      expect(
        screen.queryByRole('button', { name: 'Power' })
      ).not.toBeInTheDocument()
      for (const name of ['Elevation', 'Speed', 'Heart rate']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)
    })

    it('explains the overlay in combined mode', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))

      expect(
        await screen.findByText(
          'Pick the graphs to overlay in one chart. Hover it to follow that time point on the map.'
        )
      ).toBeInTheDocument()
    })

    it('shows a value readout on every graph while one is hovered', async () => {
      const panel = await openAnalysis()

      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)

      // A quarter of the way across => 450s of a 1800s ride => sample index 1.
      const elevationChart = hoverChart(panel, 200)

      // Hovering one graph highlights the same instant on all of them, so each
      // reports its own value at that time.
      const readouts = screen.getAllByTestId('chart-hover-value')
      expect(readouts).toHaveLength(4)
      expect(readouts.map((readout) => readout.textContent)).toEqual([
        '24m',
        '22.0km/h',
        '150W',
        '130bpm'
      ])
      expect(screen.getByText('Selected time: 7:30')).toBeInTheDocument()

      fireEvent.mouseLeave(elevationChart)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })

    it('marks the highlighted point in each series own colour', async () => {
      const panel = await openAnalysis()

      hoverChart(panel, 200)

      // Every crosshair used to share the speed chart's blue, which made a
      // stacked graph unidentifiable by its own colour.
      expect(
        screen
          .getAllByTestId('chart-hover-dot')
          .map((dot) => dot.getAttribute('class'))
      ).toEqual([
        expect.stringContaining('bg-slate-400'),
        expect.stringContaining('bg-sky-500'),
        expect.stringContaining('bg-violet-500'),
        expect.stringContaining('bg-rose-500')
      ])
      // HTML, not an SVG `circle`: under `preserveAspectRatio="none"` a circle
      // renders as an ellipse whose shape changes with the column width.
      expect(panel.querySelectorAll('circle')).toHaveLength(0)
    })

    it('keeps the heart-rate time axis aligned across a sensor dropout', async () => {
      // The strap picks up only halfway in. Dropping those samples instead of
      // holding the first real reading would compact the series and slide the
      // whole heart-rate axis left, so the readout would report an instant the
      // other three graphs are not showing.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        heartRateSeries: [0, 0, 0, 120, 140, 160]
      })

      const panel = await openAnalysis()
      hoverChart(panel, 200)

      const readouts = screen.getAllByTestId('chart-hover-value')
      expect(readouts.map((readout) => readout.textContent)).toEqual([
        '24m',
        '22.0km/h',
        '150W',
        // Index 1 of the held series [120,120,120,120,140,160] — still the
        // reading for 7:30, not the second POSITIVE sample (140).
        '120bpm'
      ])
    })

    it('reports a value that rounds to zero without a negative sign', async () => {
      // A downsampled elevation bin straddling sea level averages just below
      // zero, and `toFixed` keeps the sign: the readout used to read "-0 m".
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: [10, -0.3, 40, 55, 48, 30]
      })

      const panel = await openAnalysis()

      // Every number the chart prints comes off the same bins, so the scale
      // labels need the guard as much as the readout does — fixing only the
      // readout left this exact fixture rendering "Scale -0 m - 55 m" beside a
      // readout that said "0 m".
      expect(within(panel).getByText(/^Scale 0 m - 55 m$/)).toBeInTheDocument()
      expect(within(panel).getAllByText('0 m').length).toBeGreaterThan(0)
      expect(within(panel).queryByText(/-0 m/)).not.toBeInTheDocument()

      hoverChart(panel, 200)

      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveTextContent(
        /^0m$/
      )
    })

    it('renders a flat series without dividing by zero and scrubs accurately', async () => {
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: [50, 50, 50, 50]
      })

      const panel = await openAnalysis()
      expect(within(panel).getByText(/^Scale 50 m - 50 m$/)).toBeInTheDocument()

      const [elevationPath] = Array.from(panel.querySelectorAll('path'))
      const pathData = elevationPath.getAttribute('d') ?? ''
      expect(pathData).not.toContain('NaN')
      expect(pathData).not.toContain('Infinity')

      hoverChart(panel, 200)
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveTextContent(
        /^50m$/
      )
    })

    it('renders a single-point series without error', async () => {
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: [42]
      })

      const panel = await openAnalysis()
      expect(within(panel).getByText(/^Scale 42 m - 42 m$/)).toBeInTheDocument()

      const [elevationPath] = Array.from(panel.querySelectorAll('path'))
      const pathData = elevationPath.getAttribute('d') ?? ''
      expect(pathData).toBe('M 0.00 250.00')
    })

    it('scrubs on touch as well as on hover', async () => {
      const panel = await openAnalysis()
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))
      elevationChart.getBoundingClientRect = () =>
        ({ left: 100, width: 400 }) as DOMRect

      // A phone has no hover, so without touch handlers the readout is simply
      // unreachable there — and the charts carry their own mobile height.
      fireEvent.touchStart(elevationChart, {
        touches: [{ clientX: 200 }]
      })

      expect(
        screen.getAllByTestId('chart-hover-value').map((r) => r.textContent)
      ).toEqual(['24m', '22.0km/h', '150W', '130bpm'])

      fireEvent.touchEnd(elevationChart)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })

    it('suppresses the compatibility mouse events a tap fires afterwards', async () => {
      const panel = await openAnalysis()
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))

      // A tap is followed by a compat `mousemove` at the same point, which
      // would re-enter the scrub the instant `touchend` clears it and leave the
      // readout stuck on — no `mouseleave` ever follows a touch. Preventing the
      // default is what suppresses that sequence, and `fireEvent` returns false
      // exactly when a cancelable event was cancelled. (`touchEnd` is cancelable
      // by default in @testing-library/dom's event map.)
      expect(fireEvent.touchEnd(elevationChart)).toBe(false)
    })

    it('flips the readout before it can overflow a narrow plot', async () => {
      // Eleven samples put a hover point at exactly 0.7 of the plot, which the
      // six-sample fixture's 0.2 grid cannot reach. That is the bound that
      // matters rather than the exact constant: at the 320px reflow target the
      // plot is 220px and the widest chip ~77px, so a threshold above ~0.66
      // pushes the chip past the merged panel's `overflow-hidden`. Asserting a
      // bound leaves the value free to be retuned upward to 0.66 without a
      // spurious failure, while catching a return to the design kit's 0.72.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: Array.from({ length: 11 }, (_, index) => 10 + index * 4)
      })

      const panel = await openAnalysis()
      // Sample 7 of 0..10 — `100 + 0.7 * 400`.
      hoverChart(panel, 380)

      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        left: '70%',
        transform: 'translate(calc(-100% - 12px), -50%)'
      })
    })

    it('places the dot low at a series minimum and high at its maximum', async () => {
      const panel = await openAnalysis()

      // The elevation fixture is [10, 24, 40, 55, 48, 30]: sample 0 is its
      // minimum and sample 3 its maximum. This pins the value -> y projection
      // the line and the dot share, which inverting would swap. The dot is
      // deliberately unclamped — it marks the actual point, so it goes all the
      // way to 100%/0% — while the readout beside it is held inside the plot,
      // which is what 92%/8% is.
      hoverChart(panel, 100)
      expect(screen.getAllByTestId('chart-hover-dot')[0]).toHaveStyle({
        top: '100%'
      })
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        top: '92%'
      })

      hoverChart(panel, 340)
      expect(screen.getAllByTestId('chart-hover-dot')[0]).toHaveStyle({
        top: '0%'
      })
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        top: '8%'
      })
    })

    // `left` pins the index -> x projection the line, the dot and the readout
    // all share: sample 1 of 6 sits a fifth of the way across, sample 5 at the
    // end. Without it the scale can be changed and only the flip threshold —
    // which both cases clear by a wide margin — would notice.
    it.each([
      {
        description: 'right of the dot away from the edge',
        clientX: 200,
        left: '20%',
        transform: 'translate(12px, -50%)'
      },
      {
        description: 'flipped left of the dot near the end',
        clientX: 480,
        left: '100%',
        transform: 'translate(calc(-100% - 12px), -50%)'
      }
    ])(
      'places the readout $description',
      async ({ clientX, left, transform }) => {
        const panel = await openAnalysis()

        hoverChart(panel, clientX)

        for (const readout of screen.getAllByTestId('chart-hover-value')) {
          expect(readout).toHaveStyle({ left, transform })
        }
        // The dot is placed from the same projection, so no change to the x
        // scale can move one of the two without the other.
        for (const dot of screen.getAllByTestId('chart-hover-dot')) {
          expect(dot).toHaveStyle({ left })
        }
      }
    )

    // A 1 Hz recording arrives as one sample per second, so a plotted point per
    // ~51s of it — which is what the old flat 120-point cap produced — averages
    // every short climb and sprint away. Strava draws one point per 8 samples
    // (measured on two of its own activity Analysis pages: 5,913 -> 740 and
    // 5,272 -> 659), so these are the ratios, not round numbers. The floor and
    // ceiling clamps are covered in fitnessChartData.test.ts.
    it.each([
      { description: '5913 samples like the reference ride', raw: 5_913 },
      { description: '5272 samples like the second ride', raw: 5_272 }
    ])('plots $description at Strava density', async ({ raw }) => {
      const ramp = Array.from({ length: raw }, (_, index) => index)
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: ramp,
        speedSeries: ramp,
        powerSeries: ramp,
        heartRateSeries: ramp
      })

      const panel = await openAnalysis()

      const expected = Math.round(raw / 8)
      const pointCounts = Array.from(panel.querySelectorAll('path')).map(
        (path) => (path.getAttribute('d') ?? '').match(/[LM]/g)?.length ?? 0
      )
      expect(pointCounts).toEqual([expected, expected, expected, expected])
    })

    it('follows the scrubbed instant on the map above it', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ hasMapData: true })
      ])
      const panel = await openAnalysis({ mapProvider: { type: 'apple' } })
      await waitFor(() =>
        expect(screen.getByTestId('route-map')).toBeInTheDocument()
      )

      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-elapsed-seconds',
        ''
      )

      hoverChart(panel, 200)

      // A quarter of the way across a 1800s ride.
      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-elapsed-seconds',
        '450'
      )
    })
  })

  it('excludes 0 bpm sensor dropouts from the heart-rate average and max', async () => {
    // Without filtering, avg over [0,150,0,150,150] would be 60; the positive
    // samples [150,150,150] give avg 150 / max 150, matching the zone buckets.
    mockGetFitnessRouteData.mockResolvedValue({
      ...routeData,
      heartRateSeries: [0, 150, 0, 150, 150]
    })

    renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Heart rate zones' })
    )

    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'avg 150 · max 150 bpm'
      )
    ).toBeInTheDocument()
  })
})
