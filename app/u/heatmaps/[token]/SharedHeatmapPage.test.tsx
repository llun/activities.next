/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { SharedHeatmapPage } from './SharedHeatmapPage'
import { SharedHeatmapView } from './sharedHeatmapView'

// The route map mounts a GL map; stub it so the test stays focused on chrome.
vi.mock('@/lib/components/fitness/RouteHeatmapMap', () => ({
  RouteHeatmapMap: () => <div data-testid="route-map" />
}))

const baseView: SharedHeatmapView = {
  title: 'Veluwe',
  isWorld: false,
  bboxLabel: 'TL 52.60°N 5.60°E → BR 52.00°N 6.20°E',
  owner: { name: 'Alice Rider', handle: '@alice@llun.test', initials: 'AR' },
  generatedLabel: 'June 24, 2026',
  publicUrl: 'https://llun.test/u/heatmaps/tok123',
  heatmap: {
    id: 'hm-1',
    periodType: 'all_time',
    periodKey: 'all',
    region: 'rect:52.60,5.60,52.00,6.20',
    status: 'completed',
    bounds: null,
    segments: [],
    activityCount: 0,
    pointCount: 0,
    totalCount: 0,
    cursorOffset: 0,
    isPartial: false,
    createdAt: 1,
    updatedAt: 2
  }
}

const defaultProps = {
  view: baseView,
  signupOpen: true,
  signinUrl: '/auth/signin',
  signupUrl: '/auth/signup'
}

describe('SharedHeatmapPage', () => {
  it('renders the heatmap title, owner, date and the map', () => {
    render(<SharedHeatmapPage {...defaultProps} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Veluwe' })
    ).toBeInTheDocument()
    expect(screen.getByText('@alice@llun.test')).toBeInTheDocument()
    expect(screen.getByText('Generated June 24, 2026')).toBeInTheDocument()
    expect(
      screen.getByText('TL 52.60°N 5.60°E → BR 52.00°N 6.20°E')
    ).toBeInTheDocument()

    expect(screen.getByTestId('route-map')).toBeInTheDocument()
  })

  it('shows only the map — no read-only stats strip', () => {
    render(<SharedHeatmapPage {...defaultProps} />)

    expect(screen.queryByText('Routes')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
    expect(screen.queryByText('Period')).not.toBeInTheDocument()
  })

  it('offers a copy-link control pointing at the public URL', () => {
    render(<SharedHeatmapPage {...defaultProps} />)
    expect(
      screen.getByRole('button', { name: /Copy link/i })
    ).toBeInTheDocument()
  })

  it('shows Create account links only when sign-up is open', () => {
    const { rerender } = render(<SharedHeatmapPage {...defaultProps} />)
    expect(
      screen.getAllByRole('link', { name: /Create account/i }).length
    ).toBeGreaterThan(0)

    rerender(<SharedHeatmapPage {...defaultProps} signupOpen={false} />)
    expect(
      screen.queryByRole('link', { name: /Create account/i })
    ).not.toBeInTheDocument()
  })

  it('shows a globe heading for the whole-world heatmap', () => {
    render(
      <SharedHeatmapPage
        {...defaultProps}
        view={{
          ...baseView,
          isWorld: true,
          title: 'Whole world',
          bboxLabel: undefined
        }}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Whole world' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/TL 52\.60°N/)).not.toBeInTheDocument()
  })
})
