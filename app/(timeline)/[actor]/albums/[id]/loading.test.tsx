/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { GALLERY_GRID_CLASSES } from '@/lib/components/gallery/galleryGridClasses'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading from './loading'

// The loaded `PublicGalleryAlbumView` puts, above the grid: the Back/Copy
// link row, the cover hero, the facts block and the sort row. Each helper
// finds the skeleton's stand-in for one of them.
const backRow = (container: HTMLElement) =>
  container.querySelector(
    '[aria-busy] > .flex.items-center.justify-between.gap-3'
  )
const cover = (container: HTMLElement) =>
  container.querySelector('[aria-busy] > div.aspect-\\[4\\/3\\]')
const facts = (container: HTMLElement) =>
  container.querySelector('[aria-busy] > .space-y-1')
const sortRow = (container: HTMLElement) =>
  container.querySelector('[aria-busy] .space-y-4 > .flex.flex-wrap')
const grid = (container: HTMLElement) =>
  container.querySelector('[data-slot="gallery-grid-skeleton"]')

describe('album loading', () => {
  it('announces itself as busy, without the profile banner or avatar', () => {
    const { container } = render(<Loading />)

    expect(screen.getByText('Loading album')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByLabelText('Loading profile')).not.toBeInTheDocument()
  })

  it('mirrors the loaded rows above the grid, in order', () => {
    const { container } = render(<Loading />)

    const row = backRow(container)
    const hero = cover(container)
    const meta = facts(container)
    const sort = sortRow(container)
    const tiles = grid(container)

    // Every stand-in exists, and the loaded view's order holds: Back row,
    // cover, facts, sort row, grid.
    expect(row).toBeInTheDocument()
    expect(hero).toBeInTheDocument()
    expect(meta).toBeInTheDocument()
    expect(sort).toBeInTheDocument()
    expect(tiles).toBeInTheDocument()
    for (const [before, after] of [
      [row, hero],
      [hero, meta],
      [meta, sort],
      [sort, tiles]
    ]) {
      expect(
        (before as Element).compareDocumentPosition(after as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0)
    }
  })

  it('draws the Back row in the loaded row container, at the loaded heights', () => {
    const { container } = render(<Loading />)

    const row = backRow(container)
    expect(row).toHaveClass('flex', 'items-center', 'justify-between', 'gap-3')

    // BackLink: a 44px row below `md` (`max-md:min-h-11`), its icon-and-label
    // line (h-6) from there up.
    const back = row?.querySelector('.skeleton.w-28')
    expect(back).toHaveClass('h-6', 'max-md:min-h-11')

    // The Copy link Button: `h-8`, `pointer-coarse:h-10`.
    const copy = row?.querySelector('.skeleton.w-24')
    expect(copy).toHaveClass('h-8', 'pointer-coarse:h-10')
  })

  it('draws the cover hero with the title and subtitle over it', () => {
    const { container } = render(<Loading />)

    const hero = cover(container)
    expect(hero).toHaveClass(
      'relative',
      'aspect-[4/3]',
      'w-full',
      'rounded-lg',
      'border',
      'sm:aspect-[16/7]'
    )

    // The hero's overlay: the title (text-2xl, sm:text-3xl) and the date
    // range (mt-1 text-sm) sit on the cover, not above the grid.
    const overlay = hero?.querySelector('.absolute.inset-x-0.bottom-0')
    expect(overlay).toHaveClass('p-4', 'sm:p-6')
    const title = overlay?.querySelector('.skeleton.w-2\\/3')
    expect(title).toHaveClass('h-8', 'sm:h-9')
    const subtitle = overlay?.querySelector('.skeleton.w-1\\/3')
    expect(subtitle).toHaveClass('mt-1', 'h-5')
  })

  it('draws the facts line and the byline at the loaded line heights', () => {
    const { container } = render(<Loading />)

    const meta = facts(container)
    expect(meta).toHaveClass('space-y-1')
    const bars = meta?.querySelectorAll('.skeleton')
    expect(bars).toHaveLength(2)
    // "42 photos · 17 days" is text-sm; "By @testuser…" is text-xs.
    expect(bars?.[0]).toHaveClass('h-5')
    expect(bars?.[1]).toHaveClass('h-4')
  })

  it('draws the sort row at the loaded Select height, above the grid', () => {
    const { container } = render(<Loading />)

    const sort = sortRow(container)
    expect(sort).toHaveClass(
      'flex',
      'flex-wrap',
      'items-center',
      'justify-between',
      'gap-3'
    )
    // The species side is data-dependent and never taller than the Select,
    // so it stays empty; the Select is `h-9`, `pointer-coarse:h-10`.
    const select = sort?.querySelector('.skeleton.w-40')
    expect(select).toHaveClass('h-9', 'pointer-coarse:h-10')
  })

  it('draws the photo grid on the same columns as the loaded GalleryGrid', () => {
    const { container } = render(<Loading />)

    // The album arrives into a GalleryGrid, so its placeholder must already
    // run that grid's columns (3-up, 4-up from sm, 6-up from lg).
    const tiles = grid(container)
    expect(tiles).toBeInTheDocument()
    expect(tiles).toHaveClass(...GALLERY_GRID_CLASSES.split(' '))
  })

  it('keeps the signed-in mobile bar and desktop padding of the loaded page', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )

    // The bar (menu button, a placeholder for the title) is there from the
    // start, before the album arrives, so it does not pop in.
    const bar = container.querySelector('[data-mobile-compact-header]')
    expect(bar).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    expect(bar?.querySelector('.skeleton')).toBeInTheDocument()
    expect(bar?.nextElementSibling).toHaveAttribute('aria-busy', 'true')
    // The loaded page's `md:pt-8`, dropped in the public shell.
    expect(bar?.nextElementSibling).toHaveClass(
      'md:pt-8',
      'group-data-[shell=public]/shell:md:pt-0'
    )
  })
})
