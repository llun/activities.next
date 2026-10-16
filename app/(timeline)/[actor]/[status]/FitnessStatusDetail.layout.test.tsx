/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { screen } from '@testing-library/react'

import {
  POST_BAND_BLEED_CLASS,
  POST_BODY_PADDING_CLASS,
  POST_MEDIA_BLEED
} from './ActivityPostFrame'
import {
  buildReactedStatus,
  buildStatus,
  mockGetFitnessRouteData,
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

// The activity post is laid out like the focused post on the post page: flush
// in the page card, sections divided by full-width hairlines, no nested boxes.
// jsdom evaluates no CSS, so these assert the classes that draw that.
describe('FitnessStatusDetail post layout', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
  })

  const getPost = () =>
    document.querySelector('[data-slot="fitness-card"]') as HTMLElement
  const getBand = () => screen.getByTestId('activity-figure-band')

  it('has no frame around the post: no border box, only the bottom radius', () => {
    renderDetail()

    const post = getPost()
    expect(post).toHaveClass('bg-background')
    expect(post).not.toHaveClass('border-b')
    expect(post).not.toHaveClass('border')
    expect(post).toHaveClass('rounded-b-lg')
    expect(post).not.toHaveClass('rounded-t-lg')
  })

  it('renders the post outside the padded column, which keeps the sections', () => {
    renderDetail()

    const post = getPost()
    const column = screen.getByRole('region', { name: 'Overview' })
      .parentElement as HTMLElement
    expect(column).toHaveClass(
      '@container',
      'space-y-6',
      'border-t',
      'p-4',
      'empty:hidden'
    )
    expect(column).not.toContainElement(post)
    expect(post.parentElement).toBe(column.parentElement)
  })

  it('keeps the body padding, the band bleed and the media bleed in step', () => {
    renderDetail()

    // One Tailwind step is 0.25rem, so `p-4` and `-mx-4` are both 1rem.
    const rem = (cls: string) => `${Number(/(\d+)$/.exec(cls)![1]) * 0.25}rem`
    expect(rem(POST_BODY_PADDING_CLASS)).toBe(POST_MEDIA_BLEED)
    expect(rem(POST_BAND_BLEED_CLASS)).toBe(POST_MEDIA_BLEED)

    const body = getPost().firstElementChild as HTMLElement
    expect(body).toHaveClass('p-4', POST_BODY_PADDING_CLASS)
    expect(getBand()).toHaveClass(POST_BAND_BLEED_CLASS)
    expect(body.style.getPropertyValue('--post-media-bleed-left')).toBe(
      POST_MEDIA_BLEED
    )
    expect(body.style.getPropertyValue('--post-media-bleed-right')).toBe(
      POST_MEDIA_BLEED
    )
  })

  it('rounds the post top corners only when no header sits above it', () => {
    const { unmount } = renderDetail({ currentActor: null })
    expect(getPost()).toHaveClass('rounded-t-lg')
    unmount()

    renderDetail()
    expect(getPost()).not.toHaveClass('rounded-t-lg')
  })

  describe('the figure band', () => {
    it('runs edge to edge under a hairline, with hairline-divided flat cells', () => {
      renderDetail()

      const band = getBand()
      expect(band).toHaveClass('-mx-4', 'border-t')
      const grid = band.firstElementChild as HTMLElement
      expect(grid).toHaveClass('gap-px', 'bg-border', 'grid-cols-2')
      expect(grid.className).toContain('@min-[560px]:grid-cols-4')
      const cell = screen.getByTestId('activity-tile-distance')
      expect(cell).toHaveClass('bg-background', 'px-4', 'py-3')
      expect(cell.className).not.toMatch(/(^|\s)(border|rounded)/)
    })

    it('leaves the action row border as the only line under the band when no reactions follow', () => {
      renderDetail()

      expect(getBand()).not.toHaveClass('border-b')
      expect(getPost().firstElementChild).toHaveClass('pb-0')
      expect(screen.queryByTestId('reaction-chips')).not.toBeInTheDocument()
    })

    it('draws its own bottom line and keeps the body padding when reaction chips follow', () => {
      renderDetail({ status: buildReactedStatus() })

      expect(getBand()).toHaveClass('border-b')
      expect(getPost().firstElementChild).not.toHaveClass('pb-0')
      expect(screen.getByTestId('reaction-chips')).toBeInTheDocument()
    })

    it('keeps the body padding below the post when there are no figures', () => {
      renderDetail({
        status: buildStatus({
          fitness: {
            ...buildStatus().fitness,
            activityType: 'other',
            totalDistanceMeters: 0,
            totalDurationSeconds: 0,
            elevationGainMeters: 0
          }
        } as Parameters<typeof buildStatus>[0]),
        currentActor: null
      })

      expect(screen.queryByTestId('activity-tile-distance')).toBeNull()
      expect(getPost().firstElementChild).not.toHaveClass('pb-0')
    })
  })
})
