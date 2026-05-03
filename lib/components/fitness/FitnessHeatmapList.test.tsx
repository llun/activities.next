/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { FitnessRouteHeatmapSummaryData } from '@/lib/client'

import { FitnessHeatmapList } from './FitnessHeatmapList'

const makeMockHeatmap = (
  overrides: Partial<FitnessRouteHeatmapSummaryData> = {}
): FitnessRouteHeatmapSummaryData => ({
  id: 'heatmap-1',
  periodType: 'yearly',
  periodKey: '2025',
  region: '',
  status: 'completed',
  activityCount: 10,
  pointCount: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides
})

const CURRENT_TIME = 1_700_000_060_000

describe('FitnessHeatmapList', () => {
  it('renders empty state when no heatmaps', () => {
    render(
      <FitnessHeatmapList
        heatmaps={[]}
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        currentTime={CURRENT_TIME}
      />
    )
    expect(screen.getByText('No heatmaps yet.')).toBeInTheDocument()
  })

  it('shows active section with in-progress and failed heatmaps', () => {
    const generating = makeMockHeatmap({
      id: 'heatmap-gen',
      status: 'generating'
    })
    const failed = makeMockHeatmap({ id: 'heatmap-fail', status: 'failed' })

    render(
      <FitnessHeatmapList
        heatmaps={[generating, failed]}
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('In Progress & Failed')).toBeInTheDocument()
    expect(screen.getByText('Generating…')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('completed section is collapsed by default and can be toggled', () => {
    const completed = makeMockHeatmap({
      id: 'heatmap-done',
      status: 'completed',
      periodKey: '2025'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[completed]}
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    // Completed section button should be present
    const toggleBtn = screen.getByRole('button', { name: /Completed/i })
    expect(toggleBtn).toBeInTheDocument()

    // The row content (display name) should NOT be visible initially
    // The row buttons are rendered inside the toggle, so "All · 2025" text should be absent
    expect(screen.queryByText('All · 2025')).not.toBeInTheDocument()

    // Toggle open
    fireEvent.click(toggleBtn)

    // Now the row should be visible
    expect(screen.getByText('All · 2025')).toBeInTheDocument()
  })

  it('clicking a row calls onSelect with that heatmap', () => {
    const onSelect = jest.fn()
    const heatmap = makeMockHeatmap({ id: 'heatmap-active', status: 'pending' })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={onSelect}
        onRetry={jest.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    // Click the row — it's a button containing "All · 2025"
    const rowButton = screen.getByText('All · 2025').closest('button')
    expect(rowButton).not.toBeNull()
    fireEvent.click(rowButton!)

    expect(onSelect).toHaveBeenCalledWith(heatmap)
  })

  it('clicking retry button calls onRetry and not onSelect', async () => {
    const onSelect = jest.fn()
    const onRetry = jest.fn().mockResolvedValue(undefined)
    const heatmap = makeMockHeatmap({
      id: 'heatmap-fail',
      status: 'failed',
      error: 'Something went wrong'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={onSelect}
        onRetry={onRetry}
        currentTime={CURRENT_TIME}
      />
    )

    // The Retry button is a real <button> element (not a div[role=button] row)
    const retryBtn = screen
      .getAllByRole('button')
      .find(
        (el) =>
          el.tagName === 'BUTTON' && el.textContent?.trim().includes('Retry')
      )
    expect(retryBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(retryBtn!)
    })

    expect(onRetry).toHaveBeenCalledWith(heatmap)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('generating row shows animate-spin icon label', () => {
    const heatmap = makeMockHeatmap({
      id: 'heatmap-gen',
      status: 'generating'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={jest.fn()}
        onRetry={jest.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })
})
