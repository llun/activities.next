/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const renderAt = (pathname: string) => {
  vi.mocked(usePathname).mockReturnValue(pathname)
  return render(
    <Layout>
      <div>content</div>
    </Layout>
  )
}

describe('Admin Layout', () => {
  it('names the page you are on in the section menu', () => {
    renderAt('/admin/queues')

    expect(screen.getByRole('button', { name: 'Queues' })).toBeInTheDocument()
  })

  it('keeps a detail page under its list in the menu', () => {
    renderAt('/admin/accounts/acct-1')

    expect(screen.getByRole('button', { name: 'Accounts' })).toBeInTheDocument()
  })

  it('lists every admin page in the menu', () => {
    renderAt('/admin')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Overview' }), {
      button: 0,
      ctrlKey: false
    })
    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual([
      'Overview',
      'Accounts',
      'Reports',
      'Server rules',
      'Hashtags',
      'Announcements',
      'Filters',
      'Custom emojis',
      'Federation',
      'Relays',
      'Posts & media',
      'Network',
      'Instance',
      'Queues',
      'System'
    ])
  })

  it('renders the page inside the section', () => {
    renderAt('/admin')

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin' })
    ).toBeInTheDocument()
  })
})
