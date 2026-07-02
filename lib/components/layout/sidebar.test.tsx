/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactElement } from 'react'

import { Sidebar } from '@/lib/components/layout/sidebar'

const mockPathname = vi.fn(() => '/lists')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname()
}))

vi.mock('@/lib/components/actor-switcher/ActorSwitcher', () => ({
  ActorSwitcher: () => <div data-testid="actor-switcher" />
}))

const renderSidebar = (ui: ReactElement) => render(ui)

const lists = [
  { id: 'a', title: 'Running club' },
  { id: 'b', title: 'Fediverse devs' }
]

describe('Sidebar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/lists')
  })

  it('expands the Lists group into the user lists by default on a lists route', () => {
    renderSidebar(<Sidebar lists={lists} />)

    const nav = screen.getAllByRole('navigation')[0]
    expect(
      within(nav).getByRole('link', { name: 'Running club' })
    ).toHaveAttribute('href', '/lists/a')
    expect(
      within(nav).getByRole('link', { name: 'Fediverse devs' })
    ).toHaveAttribute('href', '/lists/b')
  })

  it('collapses and re-expands the Lists group on toggle', () => {
    renderSidebar(<Sidebar lists={lists} />)

    const nav = screen.getAllByRole('navigation')[0]
    fireEvent.click(within(nav).getByRole('button', { name: 'Collapse lists' }))
    expect(
      within(nav).queryByRole('link', { name: 'Running club' })
    ).not.toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: 'Expand lists' }))
    expect(
      within(nav).getByRole('link', { name: 'Running club' })
    ).toBeInTheDocument()
  })

  it('renders Lists as a plain link when the user has no lists', () => {
    mockPathname.mockReturnValue('/')
    renderSidebar(<Sidebar lists={[]} />)

    const nav = screen.getAllByRole('navigation')[0]
    expect(within(nav).getByRole('link', { name: 'Lists' })).toHaveAttribute(
      'href',
      '/lists'
    )
    expect(
      within(nav).queryByRole('button', { name: /lists/i })
    ).not.toBeInTheDocument()
  })
})
