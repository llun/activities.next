/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { ActivityBestEfforts } from './ActivityBestEfforts'
import {
  notMe,
  renderDetail,
  resetFitnessStatusDetailMocks
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

const efforts = [
  { durationSeconds: 5, watts: 900 },
  { durationSeconds: 60, watts: 500 },
  { durationSeconds: 300, watts: 320 }
]

describe('ActivityBestEfforts PR badge', () => {
  it('marks only the durations that equal the owner’s all-time best', () => {
    render(<ActivityBestEfforts efforts={efforts} recordDurations={[60]} />)

    const region = screen.getByRole('region', { name: 'Best efforts' })
    // The strip and the phone list each mark the one record.
    expect(within(region).getAllByText('PR')).toHaveLength(2)
    for (const badge of within(region).getAllByText('PR')) {
      const row = badge.closest('div')
      expect(row?.textContent).toContain('500 W')
      expect(row?.textContent).not.toContain('900 W')
    }
  })

  it('shows no badge without records', () => {
    render(<ActivityBestEfforts efforts={efforts} />)
    expect(screen.queryByText('PR')).not.toBeInTheDocument()
  })
})

describe('FitnessStatusDetail PR badge', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  it('shows the owner the badge for this recording', async () => {
    renderDetail({ personalRecordDurations: { 'fit-1': [5] } })

    const region = await screen.findByRole('region', { name: 'Best efforts' })
    expect(within(region).getAllByText('PR').length).toBeGreaterThan(0)
  })

  it('never shows it to anyone else, whatever reaches the component', async () => {
    renderDetail({
      currentActor: notMe,
      personalRecordDurations: { 'fit-1': [5] }
    })

    const region = await screen.findByRole('region', { name: 'Best efforts' })
    expect(within(region).queryByText('PR')).not.toBeInTheDocument()
  })

  it('shows nothing for a recording that holds no record', async () => {
    renderDetail({ personalRecordDurations: { 'fit-2': [5] } })

    const region = await screen.findByRole('region', { name: 'Best efforts' })
    expect(within(region).queryByText('PR')).not.toBeInTheDocument()
  })
})
