/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { HomeNetworkSwitch } from './HomeNetworkSwitch'

describe('HomeNetworkSwitch', () => {
  it('links each network with ?network= and marks the current one', () => {
    render(<HomeNetworkSwitch active="bluesky" />)

    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'href',
      '/'
    )
    expect(screen.getByRole('link', { name: 'Fediverse' })).toHaveAttribute(
      'href',
      '/?network=activitypub'
    )
    const bluesky = screen.getByRole('link', { name: 'Bluesky' })
    expect(bluesky).toHaveAttribute('href', '/?network=bluesky')
    expect(bluesky).toHaveAttribute('aria-current', 'page')
  })

  it('marks All when there is no filter', () => {
    render(<HomeNetworkSwitch />)

    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})
