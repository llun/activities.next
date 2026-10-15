/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  type AnalysisGraphKey,
  ChartTimeLabels,
  GraphDisplayCard,
  HeartRateZonesPanel
} from './FitnessAnalysisCharts'
import { type HeartRateZone, buildXAxisLabels } from './fitnessChartData'

describe('FitnessAnalysisCharts', () => {
  // The labels sit at equal fractions of the activity, so each must be placed at
  // its own fraction of the plot's width. `justify-between` spread the boxes
  // evenly instead, which puts a label under its time only when every label is
  // the same width — they are not ("0:00" next to "1:13:46").
  //
  // With six labels the one before the flush-right last label collides with it
  // on a phone-width plot, so the six-label charts hide exactly that one below
  // 400px of label row; the four-label overview chart hides none.
  const expectLabelsAtTheirFractions = (
    labels: HTMLElement[],
    expectedTexts: string[],
    { dropsPenultimateWhenNarrow }: { dropsPenultimateWhenNarrow: boolean }
  ) => {
    expect(labels.map((label) => label.textContent)).toEqual(expectedTexts)
    const last = labels.length - 1

    labels.forEach((label, index) => {
      if (dropsPenultimateWhenNarrow && index === last - 1) {
        expect(label).toHaveClass('hidden', '@min-[400px]:block')
      } else {
        expect(label).not.toHaveClass('hidden')
      }

      if (index === 0 || index === last) {
        // The ends are pinned to the edges, not positioned by a fraction.
        expect(label.style.left).toBe('')
      } else {
        // Centred on its fraction of the plot.
        expect(parseFloat(label.style.left)).toBeCloseTo(
          (index / last) * 100,
          5
        )
      }
    })
    // The row is the size container the hidden penultimate label's
    // `@min-[400px]` query measures: without `@container` no ancestor on the
    // status page is one, the query never matches, and that label stays hidden
    // at every width.
    expect(labels[0].parentElement).toHaveClass('@container')
  }

  describe('ChartTimeLabels', () => {
    it('puts each time label at its own fraction of the plot, whatever its width', () => {
      // A 2:02:57 ride: the middle labels are "H:MM:SS" while the first is
      // "0:00", which is what made equal-gap spacing drift off their times.
      render(
        <ChartTimeLabels
          labels={buildXAxisLabels(7377, 6)}
          dropPenultimateWhenNarrow
        />
      )

      expectLabelsAtTheirFractions(
        screen.getAllByTestId('chart-time-label'),
        ['0:00', '24:35', '49:11', '1:13:46', '1:38:22', '2:02:57'],
        { dropsPenultimateWhenNarrow: true }
      )
    })

    it('keeps every label when it is not asked to drop one', () => {
      render(<ChartTimeLabels labels={buildXAxisLabels(1200, 4)} />)

      expectLabelsAtTheirFractions(
        screen.getAllByTestId('chart-time-label'),
        ['0:00', '6:40', '13:20', '20:00'],
        { dropsPenultimateWhenNarrow: false }
      )
    })
  })

  describe('GraphDisplayCard', () => {
    const options: Array<{ key: AnalysisGraphKey; label: string }> = [
      { key: 'elevation', label: 'Elevation' },
      { key: 'power', label: 'Power' },
      { key: 'cadence', label: 'Cadence' }
    ]

    it('marks the current mode and reports a switch', () => {
      const onModeChange = vi.fn()
      render(
        <GraphDisplayCard
          mode="combined"
          onModeChange={onModeChange}
          options={options}
          selectedKeys={['power']}
          onToggle={vi.fn()}
          hint="Pick the graphs to overlay in one chart."
        />
      )

      const group = screen.getByRole('group', { name: 'Graph display mode' })
      expect(group).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Combined' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Separate' }))
      expect(onModeChange).toHaveBeenCalledWith('separate')
      expect(
        screen.getByText('Pick the graphs to overlay in one chart.')
      ).toBeInTheDocument()
    })

    it('draws one toggle chip per series, pressed when it is shown', () => {
      const onToggle = vi.fn()
      render(
        <GraphDisplayCard
          mode="separate"
          onModeChange={vi.fn()}
          options={options}
          selectedKeys={['power']}
          onToggle={onToggle}
          hint=""
        />
      )

      expect(screen.getByRole('button', { name: 'Power' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: 'Cadence' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      // A selected chip takes its series colour.
      expect(screen.getByRole('button', { name: 'Power' })).toHaveClass(
        'border-violet-500'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Cadence' }))
      expect(onToggle).toHaveBeenCalledWith('cadence')
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
})
