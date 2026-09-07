/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  type AnalysisGraphKey,
  ChartHoverMarker,
  ChartPanel,
  CombinedChartPanel,
  ElevationProfileChart,
  FitnessAnalysisCharts,
  HeartRateZonesPanel
} from './FitnessAnalysisCharts'
import { type HeartRateZone } from './fitnessChartData'

describe('FitnessAnalysisCharts', () => {
  const sampleActivitySeries = {
    elevation: [10, 24, 40, 55, 48, 30],
    speed: [15, 22, 28, 32, 25, 18],
    power: [120, 150, 210, 240, 180, 130],
    heartRate: [110, 130, 155, 168, 150, 125]
  }

  const mockSvgBoundingBox = (svg: SVGElement, left = 100, width = 400) => {
    svg.getBoundingClientRect = () =>
      ({
        left,
        width,
        top: 0,
        height: 250,
        right: left + width,
        bottom: 250,
        x: left,
        y: 0,
        toJSON: () => {}
      }) as DOMRect
  }

  describe('ChartHoverMarker', () => {
    it('renders hover dot and value chip with correct coordinates and formatting', () => {
      render(
        <div className="relative h-[250px] w-[800px]">
          <ChartHoverMarker
            x={200}
            y={100}
            width={800}
            height={250}
            value={24.5}
            unit="km/h"
            fractionDigits={1}
            dotClassName="bg-sky-500"
          />
        </div>
      )

      const dot = screen.getByTestId('chart-hover-dot')
      expect(dot).toBeInTheDocument()
      expect(dot).toHaveStyle({ left: '25%', top: '40%' })
      expect(dot).toHaveClass('bg-sky-500')

      const chip = screen.getByTestId('chart-hover-value')
      expect(chip).toBeInTheDocument()
      expect(chip).toHaveTextContent('24.5km/h')
      // x / width = 200 / 800 = 0.25 <= 0.62 threshold -> does not flip
      expect(chip).toHaveStyle({ transform: 'translate(12px, -50%)' })
    })

    it('flips the readout to the left when near the right edge', () => {
      render(
        <div className="relative h-[250px] w-[800px]">
          <ChartHoverMarker
            x={600}
            y={100}
            width={800}
            height={250}
            value={150}
            unit="w"
            fractionDigits={0}
          />
        </div>
      )

      // x / width = 600 / 800 = 0.75 > 0.62 -> flips left
      const chip = screen.getByTestId('chart-hover-value')
      expect(chip).toHaveStyle({
        transform: 'translate(calc(-100% - 12px), -50%)'
      })
    })
  })

  describe('ElevationProfileChart', () => {
    it('renders SVG profile with 4 time axis labels and responds to scrub', () => {
      const onHighlight = vi.fn()
      const { container } = render(
        <ElevationProfileChart
          values={sampleActivitySeries.elevation}
          durationSeconds={1800}
          highlightedElapsedSeconds={null}
          onHighlightElapsedSeconds={onHighlight}
        />
      )

      expect(
        screen.getByTestId('overview-elevation-profile')
      ).toBeInTheDocument()
      const labels = container.querySelectorAll('span')
      const labelTexts = Array.from(labels).map((l) => l.textContent)
      expect(labelTexts).toEqual(['0:00', '10:00', '20:00', '30:00'])

      const svg = container.querySelector('svg')!
      mockSvgBoundingBox(svg, 100, 400)

      // Mouse move to scrub: 200px clientX -> ratio (200 - 100) / 400 = 0.25 -> 450s
      fireEvent.mouseMove(svg, { clientX: 200 })
      expect(onHighlight).toHaveBeenCalledWith(450)

      // Mouse leave clears scrub
      fireEvent.mouseLeave(svg)
      expect(onHighlight).toHaveBeenCalledWith(null)
    })

    it('handles touch events on mobile', () => {
      const onHighlight = vi.fn()
      const { container } = render(
        <ElevationProfileChart
          values={sampleActivitySeries.elevation}
          durationSeconds={1800}
          highlightedElapsedSeconds={null}
          onHighlightElapsedSeconds={onHighlight}
        />
      )

      const svg = container.querySelector('svg')!
      mockSvgBoundingBox(svg, 100, 400)

      fireEvent.touchStart(svg, { touches: [{ clientX: 300 }] })
      // (300 - 100) / 400 = 0.5 -> 900s
      expect(onHighlight).toHaveBeenCalledWith(900)

      fireEvent.touchEnd(svg)
      expect(onHighlight).toHaveBeenCalledWith(null)
    })

    it('renders hover dot and value chip when highlightedElapsedSeconds is provided', () => {
      render(
        <ElevationProfileChart
          values={sampleActivitySeries.elevation}
          durationSeconds={1800}
          highlightedElapsedSeconds={450}
          onHighlightElapsedSeconds={vi.fn()}
        />
      )

      expect(screen.getByTestId('chart-hover-dot')).toBeInTheDocument()
      const chip = screen.getByTestId('chart-hover-value')
      expect(chip).toBeInTheDocument()
      expect(chip).toHaveTextContent(/^24m$/)
    })
  })

  describe('HeartRateZonesPanel', () => {
    const mockZones: HeartRateZone[] = [
      {
        name: 'Z1',
        label: 'Recovery',
        lo: 0,
        hi: 122,
        color: 'hsl(205 45% 62%)',
        seconds: 300,
        pct: 17,
        rawPct: 16.67
      },
      {
        name: 'Z2',
        label: 'Endurance',
        lo: 122,
        hi: 142,
        color: 'hsl(142 60% 45%)',
        seconds: 600,
        pct: 33,
        rawPct: 33.33
      },
      {
        name: 'Z3',
        label: 'Tempo',
        lo: 142,
        hi: 158,
        color: 'hsl(45 92% 50%)',
        seconds: 500,
        pct: 28,
        rawPct: 27.78
      },
      {
        name: 'Z4',
        label: 'Threshold',
        lo: 158,
        hi: 172,
        color: 'hsl(24 95% 50%)',
        seconds: 400,
        pct: 22,
        rawPct: 22.22
      },
      {
        name: 'Z5',
        label: 'Anaerobic',
        lo: 172,
        hi: null,
        color: 'hsl(2 78% 55%)',
        seconds: 0,
        pct: 0,
        rawPct: 0
      }
    ]

    it('renders stacked zone bar and each zone row with labels, range, and formatted duration', () => {
      render(<HeartRateZonesPanel zones={mockZones} />)

      expect(screen.getByText('Recovery')).toBeInTheDocument()
      expect(screen.getByText('Endurance')).toBeInTheDocument()
      expect(screen.getByText('Tempo')).toBeInTheDocument()
      expect(screen.getByText('Threshold')).toBeInTheDocument()
      expect(screen.getByText('Anaerobic')).toBeInTheDocument()

      expect(screen.getByText('< 122 bpm')).toBeInTheDocument()
      expect(screen.getByText('122–142 bpm')).toBeInTheDocument()
      expect(screen.getByText('172+ bpm')).toBeInTheDocument()

      expect(screen.getByText('5:00')).toBeInTheDocument()
      expect(screen.getByText('10:00')).toBeInTheDocument()
    })
  })

  describe('ChartPanel', () => {
    it('renders title, scale range, SVG path, and scale badges', () => {
      const { container } = render(
        <ChartPanel
          title="Speed"
          unit="km/h"
          values={[10, 20, 30]}
          minLabel="10.0"
          maxLabel="30.0"
          fractionDigits={1}
          durationSeconds={1200}
        />
      )

      expect(
        screen.getByRole('heading', { level: 3, name: 'Speed' })
      ).toBeInTheDocument()
      expect(
        screen.getByText('Scale 10.0 km/h - 30.0 km/h')
      ).toBeInTheDocument()
      expect(container.querySelector('path')).toBeInTheDocument()
    })
  })

  describe('CombinedChartPanel', () => {
    const combinedSeries = [
      {
        key: 'speed' as AnalysisGraphKey,
        label: 'Speed',
        unit: 'km/h',
        values: [15, 25, 35],
        fractionDigits: 1
      },
      {
        key: 'power' as AnalysisGraphKey,
        label: 'Power',
        unit: 'w',
        values: [100, 200, 300],
        fractionDigits: 0
      }
    ]

    it('renders combined chart with legends, paths, and hover details', () => {
      const onHighlight = vi.fn()
      const { container } = render(
        <CombinedChartPanel
          series={combinedSeries}
          durationSeconds={1200}
          highlightedElapsedSeconds={600}
          onHighlightElapsedSeconds={onHighlight}
        />
      )

      expect(screen.getByText('Combined')).toBeInTheDocument()
      expect(screen.getByText('Speed')).toBeInTheDocument()
      expect(screen.getByText('Power')).toBeInTheDocument()
      expect(
        screen.getByText('Each graph is scaled to its own range.')
      ).toBeInTheDocument()

      // Two series -> 2 paths in SVG
      const paths = container.querySelectorAll('svg path')
      expect(paths).toHaveLength(2)

      // Hover dots and combined readout
      expect(screen.getAllByTestId('combined-hover-dot')).toHaveLength(2)
      const readout = screen.getByTestId('combined-hover-value')
      expect(readout).toBeInTheDocument()
      expect(within(readout).getByText('25.0')).toBeInTheDocument()
      expect(within(readout).getByText('km/h')).toBeInTheDocument()
      expect(within(readout).getByText('200')).toBeInTheDocument()
      expect(within(readout).getByText('w')).toBeInTheDocument()

      const svg = container.querySelector('svg')!
      mockSvgBoundingBox(svg, 100, 400)
      fireEvent.mouseMove(svg, { clientX: 200 })
      expect(onHighlight).toHaveBeenCalledWith(300)

      fireEvent.mouseLeave(svg)
      expect(onHighlight).toHaveBeenCalledWith(null)
    })
  })

  describe('FitnessAnalysisCharts (integrated)', () => {
    it('shows empty message when no series are available', () => {
      render(
        <FitnessAnalysisCharts
          activitySeries={{
            elevation: [],
            speed: [],
            power: [],
            heartRate: []
          }}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={['elevation', 'speed', 'power', 'heart-rate']}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(
        screen.getByText('No analysis data is available for this activity.')
      ).toBeInTheDocument()
    })

    it('shows loading message when loading and no data', () => {
      render(
        <FitnessAnalysisCharts
          activitySeries={{
            elevation: [],
            speed: [],
            power: [],
            heartRate: []
          }}
          isRouteDataLoading={true}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={['elevation']}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(screen.getByText('Loading analysis data…')).toBeInTheDocument()
    })

    it('renders separate graphs by default and allows toggling display mode', () => {
      const onModeChange = vi.fn()
      render(
        <FitnessAnalysisCharts
          activitySeries={sampleActivitySeries}
          durationSeconds={1800}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={onModeChange}
          selectedGraphKeys={['elevation', 'speed', 'power', 'heart-rate']}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(screen.getByTestId('analysis-graphs')).toBeInTheDocument()
      expect(
        screen.queryByTestId('analysis-combined-graph')
      ).not.toBeInTheDocument()

      const combinedBtn = screen.getByRole('button', { name: 'Combined' })
      fireEvent.click(combinedBtn)
      expect(onModeChange).toHaveBeenCalledWith('combined')
    })

    it('renders combined chart when graphDisplayMode is combined', () => {
      render(
        <FitnessAnalysisCharts
          activitySeries={sampleActivitySeries}
          durationSeconds={1800}
          graphDisplayMode="combined"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={['elevation', 'speed', 'power', 'heart-rate']}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(screen.getByTestId('analysis-combined-graph')).toBeInTheDocument()
      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
    })

    it('handles metric visibility toggles via onToggleGraphKey', () => {
      const onToggle = vi.fn()
      render(
        <FitnessAnalysisCharts
          activitySeries={sampleActivitySeries}
          durationSeconds={1800}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={['elevation', 'speed']}
          onToggleGraphKey={onToggle}
        />
      )

      const elevationChip = screen.getByRole('button', { name: 'Elevation' })
      expect(elevationChip).toHaveAttribute('aria-pressed', 'true')

      const powerChip = screen.getByRole('button', { name: 'Power' })
      expect(powerChip).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(powerChip)
      expect(onToggle).toHaveBeenCalledWith('power')
    })

    it('shows hint when all graphs are deselected', () => {
      render(
        <FitnessAnalysisCharts
          activitySeries={sampleActivitySeries}
          durationSeconds={1800}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={[]}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(
        screen.getByText('Select at least one graph to display.')
      ).toBeInTheDocument()
      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('analysis-combined-graph')
      ).not.toBeInTheDocument()
    })

    it('displays selected time when highlightedElapsedSeconds is passed', () => {
      render(
        <FitnessAnalysisCharts
          activitySeries={sampleActivitySeries}
          durationSeconds={1800}
          highlightedElapsedSeconds={450}
          graphDisplayMode="separate"
          onGraphDisplayModeChange={vi.fn()}
          selectedGraphKeys={['elevation']}
          onToggleGraphKey={vi.fn()}
        />
      )

      expect(screen.getByText('Selected time: 7:30')).toBeInTheDocument()
    })
  })
})
