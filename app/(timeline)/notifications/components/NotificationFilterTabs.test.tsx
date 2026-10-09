/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { NotificationFilterTabs } from './NotificationFilterTabs'

describe('NotificationFilterTabs', () => {
  it('links each filter to its own page and marks the current one', () => {
    render(<NotificationFilterTabs active="all" />)

    const nav = screen.getByRole('navigation', {
      name: 'Filter notifications'
    })
    const all = within(nav).getByRole('link', { name: 'All' })
    const mentions = within(nav).getByRole('link', { name: 'Mentions' })

    expect(all).toHaveAttribute('href', '/notifications')
    expect(mentions).toHaveAttribute('href', '/notifications?type=mentions')
    expect(all).toHaveAttribute('aria-current', 'page')
    expect(mentions).not.toHaveAttribute('aria-current')
  })

  it('marks Mentions as current on the mentions filter', () => {
    render(<NotificationFilterTabs active="mentions" />)

    expect(screen.getByRole('link', { name: 'Mentions' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute(
      'aria-current'
    )
  })
})
