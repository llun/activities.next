/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { onTestFinished } from 'vitest'

import type { FitnessRouteDataResponse } from '@/lib/client'
import type { StatusNote } from '@/lib/types/domain/status'

import {
  buildFitnessFile,
  buildStatus,
  mockGetFitnessFilesByStatus,
  mockGetFitnessRouteData,
  renderDetail,
  resetFitnessStatusDetailMocks,
  routeData
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  makeFitnessFilePrimary: vi.fn(),
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
// imperative GL handle, so it is where a test can read back the instant and
// the range the page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

/**
 * A 30-minute, 5 km ride recorded every 10 s, with everything a head unit
 * writes: power, heart rate, cadence, temperature, altitude and three laps of
 * ten minutes. It is flat for ten minutes, climbs 60 m over the next ten (a
 * steady 3.6 %) and is flat again, so exactly one climb is found.
 */
const buildRichRouteData = (
  overrides: Partial<FitnessRouteDataResponse> = {}
): FitnessRouteDataResponse => {
  const count = 181
  const samples = Array.from({ length: count }, (_, index) => {
    const elapsedSeconds = index * 10
    const altitude =
      elapsedSeconds < 600
        ? 10
        : elapsedSeconds < 1200
          ? 10 + (60 * (elapsedSeconds - 600)) / 600
          : 70
    return {
      lat: 52 + index * 0.0002,
      lng: 5 + index * 0.0002,
      elapsedSeconds,
      distanceMeters: (5000 * index) / (count - 1),
      altitude,
      speed: 10,
      power: 150 + (index % 7) * 10,
      heartRate: 140 + (index % 10),
      cadence: 85,
      temperature: 14 + (4 * index) / (count - 1)
    }
  })
  return {
    samples,
    totalDurationSeconds: 1800,
    powerSeries: samples.map((sample) => sample.power),
    heartRateSeries: samples.map((sample) => sample.heartRate),
    altitudeSeries: samples.map((sample) => sample.altitude),
    speedSeries: samples.map((sample) => sample.speed),
    laps: [0, 600, 1200].map((startElapsedSeconds, index) => ({
      startElapsedSeconds,
      durationSeconds: 600,
      distanceMeters: 5000 / 3,
      avgPower: [150, 200, 170][index]
    })),
    calories: 412,
    ...overrides
  }
}

// A series chip is named by its label alone ("Power"), unlike a lap button.
const getChip = (name: string) =>
  within(screen.getByRole('region', { name: 'Analysis' })).getByRole('button', {
    name
  })

const renderAnalysis = async (
  props: Parameters<typeof renderDetail>[0] = {}
) => {
  renderDetail(props)
  return screen.findByRole('region', { name: 'Analysis' })
}

// The plot reads the pointer against its own box, which jsdom leaves empty.
const hoverPlot = (plot: HTMLElement, clientX: number) => {
  plot.getBoundingClientRect = () =>
    ({ left: 100, width: 400, top: 0, height: 200 }) as DOMRect
  fireEvent.pointerMove(plot, { clientX })
}

describe('FitnessStatusDetail analysis', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  describe('graph display', () => {
    it('offers a chip per series the file has, the default ones pressed, overlaid in one chart', async () => {
      const analysis = await renderAnalysis()

      expect(
        within(analysis).getByText('4 graphs from the FIT file')
      ).toBeInTheDocument()
      // Speed starts off when there is power: power tells the effort.
      expect(getChip('Elevation')).toHaveAttribute('aria-pressed', 'true')
      expect(getChip('Speed')).toHaveAttribute('aria-pressed', 'false')
      expect(getChip('Power')).toHaveAttribute('aria-pressed', 'true')
      expect(getChip('Heart rate')).toHaveAttribute('aria-pressed', 'true')
      // No chip for a series the file has nothing for.
      expect(
        within(analysis).queryByRole('button', { name: 'Cadence' })
      ).not.toBeInTheDocument()

      const plot = within(analysis).getByTestId('analysis-combined-plot')
      expect(within(plot).getByTestId('chart-series-power')).toBeInTheDocument()
      expect(
        within(plot).queryByTestId('chart-series-speed')
      ).not.toBeInTheDocument()
    })

    it('toggles a series with its chip and keeps the choice across display modes', async () => {
      const analysis = await renderAnalysis()

      fireEvent.click(getChip('Power'))
      fireEvent.click(getChip('Speed'))
      expect(getChip('Power')).toHaveAttribute('aria-pressed', 'false')
      expect(
        within(analysis).queryByTestId('chart-series-power')
      ).not.toBeInTheDocument()
      expect(
        within(analysis).getByTestId('chart-series-speed')
      ).toBeInTheDocument()

      fireEvent.click(
        within(analysis).getByRole('button', { name: 'Separate' })
      )

      expect(
        within(analysis).queryByTestId('analysis-row-power')
      ).not.toBeInTheDocument()
      expect(
        within(analysis).getByTestId('analysis-row-speed')
      ).toHaveTextContent(/Scale 0\.0 – \d+\.\d km\/h/)
      expect(
        within(analysis).getByText(
          'Pick the graphs to show. Hover any graph to follow that time point on the map.',
          { exact: false }
        )
      ).toBeInTheDocument()
    })

    it('asks for a graph when every chip is off', async () => {
      const analysis = await renderAnalysis()

      for (const name of ['Elevation', 'Power', 'Heart rate']) {
        fireEvent.click(getChip(name))
      }

      expect(
        within(analysis).getByText('Select at least one graph to display.')
      ).toBeInTheDocument()
    })

    it('offers cadence and temperature from a file that records them', async () => {
      mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
      const analysis = await renderAnalysis()

      await waitFor(() =>
        expect(getChip('Cadence')).toHaveAttribute('aria-pressed', 'true')
      )
      expect(getChip('Temperature')).toBeInTheDocument()
      // Grade comes from the elevation, and starts off.
      expect(getChip('Grade')).toHaveAttribute('aria-pressed', 'false')
      expect(
        within(analysis).getByText('7 graphs from the FIT file')
      ).toBeInTheDocument()
    })
  })

  describe('scrubbing', () => {
    it('reads out every shown series and follows the instant on the map', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ hasMapData: true })
      ])
      mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
      const analysis = await renderAnalysis({ mapProvider: { type: 'apple' } })
      const map = await screen.findByTestId('route-map')
      expect(map).toHaveAttribute('data-highlighted-elapsed-seconds', '')

      const plot = within(analysis).getByTestId('analysis-combined-plot')
      // A quarter of the way across a 1800 s ride.
      hoverPlot(plot, 200)

      expect(map).toHaveAttribute('data-highlighted-elapsed-seconds', '450')
      const readout = within(analysis).getByTestId('analysis-readout')
      expect(readout).toHaveTextContent('7:30')
      expect(readout).toHaveTextContent('1.3 km · lap 1')
      expect(readout).toHaveTextContent(/Power\d+ W/)
      expect(readout).toHaveTextContent('Cadence85 rpm')

      fireEvent.pointerLeave(plot)
      expect(
        within(analysis).queryByTestId('analysis-readout')
      ).not.toBeInTheDocument()
      expect(map).toHaveAttribute('data-highlighted-elapsed-seconds', '')
    })

    it('flips the readout before it can overflow a narrow plot, and keeps it inside', async () => {
      mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
      const analysis = await renderAnalysis()
      await within(analysis).findByText('7 graphs from the FIT file')
      const plot = within(analysis).getByTestId('analysis-combined-plot')
      // A 300px plot, as on a phone, and a 160px readout.
      Object.defineProperty(plot, 'clientWidth', {
        configurable: true,
        value: 300
      })
      const offsetWidth = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.dataset.testid === 'analysis-readout' ? 160 : 0
        })
      onTestFinished(() => offsetWidth.mockRestore())
      const readoutLeft = () =>
        within(analysis).getByTestId('analysis-readout').style.left

      // 22.5% across (x 67.5): room on the right of the crosshair.
      hoverPlot(plot, 190)
      expect(readoutLeft()).toBe('77.5px')
      // 90% across (x 270): no room on the right, so it flips left.
      hoverPlot(plot, 460)
      await waitFor(() => expect(readoutLeft()).toBe('102px'))
      // Halfway (x 150): room on neither side, so it is centred on the
      // crosshair and clamped inside the plot.
      hoverPlot(plot, 300)
      await waitFor(() => expect(readoutLeft()).toBe('70px'))
    })

    it('shows the value under the pointer beside each separate graph', async () => {
      const analysis = await renderAnalysis()
      fireEvent.click(
        within(analysis).getByRole('button', { name: 'Separate' })
      )

      const row = within(analysis).getByTestId('analysis-row-power')
      const plot = row.querySelector('svg')?.parentElement as HTMLElement
      hoverPlot(plot, 100)

      // The first of [120, 150, 180, 210, 90, 60].
      expect(row).toHaveTextContent('120 W')
      expect(
        within(analysis).getByTestId('analysis-row-elevation')
      ).toHaveTextContent('10 m')
    })
  })

  describe('laps and climbs', () => {
    beforeEach(() => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ hasMapData: true })
      ])
      mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
    })

    it('lays the laps along the top of the chart, all the same width', async () => {
      const analysis = await renderAnalysis({ mapProvider: { type: 'apple' } })

      const band = await within(analysis).findByRole('group', { name: 'Laps' })
      const buttons = within(band).getAllByRole('button')
      expect(buttons).toHaveLength(3)
      expect(buttons[0]).toHaveTextContent('Lap 1 · 10:00')
      expect(buttons[1]).toHaveTextContent('200 W')
      for (const button of buttons) {
        expect(button).toHaveClass('flex-1', 'basis-0')
        expect(button.style.flexGrow).toBe('')
      }
    })

    it('highlights a lap on the chart, the table and the map, and clears it on a second click', async () => {
      const analysis = await renderAnalysis({ mapProvider: { type: 'apple' } })
      const band = await within(analysis).findByRole('group', { name: 'Laps' })
      const lapTwo = within(band).getAllByRole('button')[1]

      fireEvent.click(lapTwo)

      expect(lapTwo).toHaveAttribute('aria-pressed', 'true')
      expect(
        within(analysis).getByText('Lap 2 selected · click again to clear')
      ).toBeInTheDocument()
      expect(
        within(analysis).getByTestId('chart-selected-range')
      ).toBeInTheDocument()
      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-range',
        '600-1200'
      )
      const lapsTable = screen.getByRole('region', { name: 'Laps' })
      expect(
        within(lapsTable).getByRole('button', { name: 'Lap 2' })
      ).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(lapTwo)

      expect(lapTwo).toHaveAttribute('aria-pressed', 'false')
      expect(
        within(analysis).queryByTestId('chart-selected-range')
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-range',
        ''
      )
    })

    it('picks a climb from its table row and scrolls the chart into view', async () => {
      // jsdom has no scrolling, so the method is stubbed for this test only.
      const scrollIntoView = vi.fn()
      const original = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = scrollIntoView
      onTestFinished(() => {
        Element.prototype.scrollIntoView = original
      })
      const analysis = await renderAnalysis({ mapProvider: { type: 'apple' } })
      const climbs = await screen.findByRole('region', { name: 'Climbs' })

      expect(
        within(climbs).getByText('1 · found from elevation')
      ).toBeInTheDocument()
      expect(within(climbs).getByText(/^from km \d+\.\d$/)).toBeInTheDocument()
      // Shaded on the chart whether picked or not.
      expect(within(analysis).getAllByTestId('chart-climb')).toHaveLength(1)

      fireEvent.click(within(climbs).getByRole('button', { name: 'Climb 1' }))

      expect(
        within(climbs).getByRole('button', { name: 'Climb 1' })
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        within(analysis).getByText('Climb 1 selected · click again to clear')
      ).toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalled()
      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-range',
        expect.stringMatching(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
      )
    })

    it('gives both tables the same columns, leaving out what the file lacks', async () => {
      mockGetFitnessRouteData.mockResolvedValue(
        buildRichRouteData({
          samples: buildRichRouteData().samples.map((sample) => ({
            ...sample,
            cadence: undefined
          }))
        })
      )
      renderDetail()
      const laps = await screen.findByRole('region', { name: 'Laps' })
      const climbs = screen.getByRole('region', { name: 'Climbs' })

      const headers = (region: HTMLElement) =>
        within(region)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent)
      expect(headers(laps)).toEqual([
        'Lap',
        'Time',
        'Distance',
        'Speed',
        'Power',
        'HR',
        'Gain',
        'Grade'
      ])
      expect(headers(climbs).slice(1)).toEqual(headers(laps).slice(1))
      expect(within(laps).getByText('3 · every 1.7 km')).toBeInTheDocument()
      expect(within(laps).getByText('1.7 – 3.3 km')).toBeInTheDocument()
    })
  })

  describe('power sections', () => {
    it('shows best efforts, the power distribution and the power curve', async () => {
      mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
      renderDetail()

      const efforts = await screen.findByRole('region', {
        name: 'Best efforts'
      })
      expect(within(efforts).getAllByText('5 s').length).toBeGreaterThan(0)
      expect(within(efforts).getAllByText('20 min').length).toBeGreaterThan(0)

      const distribution = screen.getByRole('region', {
        name: 'Power distribution'
      })
      expect(
        within(distribution).getByTestId('power-average-line')
      ).toBeInTheDocument()
      expect(
        within(distribution).getByText(/^Dashed: average power \d+ W$/)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Power curve' })
      ).toBeInTheDocument()
    })

    it('leaves every power section out of a file with no power', async () => {
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        powerSeries: []
      })
      renderDetail()

      expect(
        await screen.findByRole('region', { name: 'Heart rate zones' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Best efforts' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Power distribution' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Power curve' })
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByRole('region', { name: 'Analysis' })).queryByRole(
          'button',
          { name: 'Power' }
        )
      ).not.toBeInTheDocument()
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

    const zones = await screen.findByRole('region', {
      name: 'Heart rate zones'
    })
    expect(within(zones).getByText('avg 150 · max 150')).toBeInTheDocument()
  })

  it('doubles a run cadence to steps per minute', async () => {
    mockGetFitnessRouteData.mockResolvedValue(buildRichRouteData())
    renderDetail({
      status: buildStatus({
        fitness: { ...buildStatus().fitness, activityType: 'run' }
      } as Partial<StatusNote>)
    })

    const overview = screen.getByRole('region', { name: 'Overview' })
    expect(await within(overview).findByText('170 spm')).toBeInTheDocument()
  })

  it('charts a file with no GPS from its metric samples', async () => {
    const rich = buildRichRouteData()
    mockGetFitnessRouteData.mockResolvedValue({
      samples: [],
      totalDurationSeconds: 1800,
      powerSeries: rich.powerSeries,
      heartRateSeries: rich.heartRateSeries,
      metricSamples: rich.samples.map(
        ({ lat: _lat, lng: _lng, ...sample }) => sample
      )
    })
    const analysis = await renderAnalysis()

    await waitFor(() => expect(getChip('Cadence')).toBeInTheDocument())
    expect(
      within(analysis).getByTestId('chart-series-cadence')
    ).toBeInTheDocument()
    // No route, so no map in the overview.
    expect(screen.queryByTestId('route-map')).not.toBeInTheDocument()
  })

  it('says so when the route data cannot be loaded', async () => {
    mockGetFitnessRouteData.mockRejectedValue(new Error('boom'))
    renderDetail()

    expect(
      await screen.findByText(
        'Could not load route and analysis data for this activity.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Analysis' })
    ).not.toBeInTheDocument()
  })
})
