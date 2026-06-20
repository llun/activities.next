/**
 * @vitest-environment jsdom
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
  totalCount: 0,
  cursorOffset: 0,
  isPartial: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides
})

const CURRENT_TIME = 1_700_000_060_000

const findButtonByText = (text: string) =>
  screen
    .getAllByRole('button')
    .find(
      (el) => el.tagName === 'BUTTON' && el.textContent?.trim().includes(text)
    )

describe('FitnessHeatmapList', () => {
  it('renders empty state when no heatmaps', () => {
    render(
      <FitnessHeatmapList
        heatmaps={[]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
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
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(
      screen.getByText('In Progress & Needs Attention')
    ).toBeInTheDocument()
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
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
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
    const onSelect = vi.fn()
    const heatmap = makeMockHeatmap({ id: 'heatmap-active', status: 'pending' })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={onSelect}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
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
    const onSelect = vi.fn()
    const onRetry = vi.fn().mockResolvedValue(undefined)
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
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    // The Retry button is a real <button> element (not a div[role=button] row)
    const retryBtn = findButtonByText('Retry')
    expect(retryBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(retryBtn!)
    })

    expect(onRetry).toHaveBeenCalledWith(heatmap)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('summarizes the region scope on each row', () => {
    const world = makeMockHeatmap({
      id: 'hm-world',
      status: 'pending',
      region: ''
    })
    const rect = makeMockHeatmap({
      id: 'hm-rect',
      status: 'failed',
      region: 'rect:52.60,5.60,52.00,6.20'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[world, rect]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('Whole world')).toBeInTheDocument()
    expect(screen.getByText('1 map area')).toBeInTheDocument()
  })

  it('generating row shows animate-spin icon label', () => {
    const heatmap = makeMockHeatmap({
      id: 'heatmap-gen',
      status: 'generating'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })

  it('shows a determinate progress bar while generating with a known total', () => {
    const heatmap = makeMockHeatmap({
      id: 'heatmap-progress',
      status: 'generating',
      totalCount: 10,
      cursorOffset: 3
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('3 / 10 files (30%)')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '30')
  })

  it('shows an indeterminate scanned count when the total is not yet known', () => {
    const heatmap = makeMockHeatmap({
      id: 'heatmap-progress-unknown',
      status: 'generating',
      totalCount: 0,
      cursorOffset: 5
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(screen.getByText('5 files scanned')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
  })

  it('clicking remove on a failed row calls onRemove and not onSelect', () => {
    const onSelect = vi.fn()
    const onRemove = vi.fn()
    const heatmap = makeMockHeatmap({
      id: 'heatmap-fail-remove',
      status: 'failed',
      error: 'boom'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={onSelect}
        onRetry={vi.fn()}
        onRemove={onRemove}
        currentTime={CURRENT_TIME}
      />
    )

    const removeBtn = findButtonByText('Remove')
    expect(removeBtn).toBeDefined()

    fireEvent.click(removeBtn!)

    expect(onRemove).toHaveBeenCalledWith(heatmap)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not show a remove action for in-flight heatmaps', () => {
    const generating = makeMockHeatmap({
      id: 'heatmap-gen-noremove',
      status: 'generating'
    })
    const pending = makeMockHeatmap({
      id: 'heatmap-pending-noremove',
      status: 'pending'
    })

    render(
      <FitnessHeatmapList
        heatmaps={[generating, pending]}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(findButtonByText('Remove')).toBeUndefined()
  })

  it('labels capped completed heatmaps as partial with a resume action', async () => {
    const onSelect = vi.fn()
    const onRetry = vi.fn().mockResolvedValue(undefined)
    const heatmap = makeMockHeatmap({
      id: 'heatmap-partial',
      status: 'completed',
      isPartial: true
    })

    render(
      <FitnessHeatmapList
        heatmaps={[heatmap]}
        onSelect={onSelect}
        onRetry={onRetry}
        onRemove={vi.fn()}
        currentTime={CURRENT_TIME}
      />
    )

    expect(
      screen.getByText('In Progress & Needs Attention')
    ).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Resume/i }))
    })

    expect(onRetry).toHaveBeenCalledWith(heatmap)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
