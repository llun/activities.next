/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const renderLayout = () =>
  render(
    <Layout>
      <div>content</div>
    </Layout>
  )

describe('Gallery Layout', () => {
  // The most specific matching tab wins: '/gallery' (Subjects) is a prefix of
  // every nested path but must never beat the deeper tab.
  it.each([
    ['/gallery', 'Subjects'],
    ['/gallery/subjects/sci%3Aalcedo%20atthis', 'Subjects'],
    ['/gallery/recent', 'Recent'],
    ['/gallery/albums', 'Albums'],
    ['/gallery/albums/abc123', 'Albums'],
    ['/gallery/map', 'Map'],
    ['/gallery/life-list', 'Life list'],
    ['/gallery/gear', 'Gear'],
    ['/gallery/gear/abc123', 'Gear'],
    ['/gallery/privacy', 'Privacy']
  ])('reflects the active tab in the dropdown trigger on %s', (path, label) => {
    ;(usePathname as jest.Mock).mockReturnValue(path)
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Gallery' })
    expect(within(nav).getByRole('button')).toHaveTextContent(label)
  })

  it('renders the section header above the dropdown nav', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/gallery')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Gallery' })
    const nav = screen.getByRole('navigation', { name: 'Gallery' })
    expect(
      heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByText('Your photos and videos, by subject, place and gear')
    ).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('lists the seven sections, in order, with Albums after Recent', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/gallery')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Gallery' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Subjects',
      'Recent',
      'Albums',
      'Map',
      'Life list',
      'Gear',
      'Privacy'
    ])
    expect(items.map((item) => item.getAttribute('href'))).toEqual([
      '/gallery',
      '/gallery/recent',
      '/gallery/albums',
      '/gallery/map',
      '/gallery/life-list',
      '/gallery/gear',
      '/gallery/privacy'
    ])
  })

  it('marks the active section as current in the opened dropdown', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/gallery/life-list')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Gallery' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })

    const menu = await screen.findByRole('menu')
    expect(
      within(menu).getByRole('menuitem', { name: 'Life list' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(menu).getByRole('menuitem', { name: 'Subjects' })
    ).not.toHaveAttribute('aria-current')
  })

  it('drops the section top padding below md only', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/gallery')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Gallery' })
    expect(nav.parentElement).toHaveClass('pt-4', 'max-md:pt-0')
  })
})
