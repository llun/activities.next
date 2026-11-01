/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ProfileMovedBanner } from './ProfileMovedBanner'

describe('ProfileMovedBanner', () => {
  it('points a visitor at the new profile', () => {
    render(
      <ProfileMovedBanner
        acct="may@new.example"
        href="https://new.example/users/may"
        external
        isOwner={false}
        isRedirect={false}
      />
    )

    expect(screen.getByText('This profile has moved to')).toBeInTheDocument()
    expect(screen.getByText('@may@new.example')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Follow them at their new profile. Posts here stay as they were.'
      )
    ).toBeInTheDocument()

    const go = screen.getByRole('link', { name: /Go to new profile/ })
    expect(go).toHaveAttribute('href', 'https://new.example/users/may')
    expect(go).toHaveAttribute('target', '_blank')
    // A visitor never gets the owner's way in.
    expect(
      screen.queryByRole('link', { name: /Manage/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Cancel redirect/ })
    ).not.toBeInTheDocument()
  })

  it('gives the owner the Manage way into the Moving settings', () => {
    render(
      <ProfileMovedBanner
        acct="may@new.example"
        href="https://new.example/users/may"
        external
        isOwner
        isRedirect={false}
      />
    )

    expect(screen.getByRole('link', { name: /Manage/ })).toHaveAttribute(
      'href',
      '/settings/moving'
    )
  })

  it('draws the banner without a link when the target is not stored', () => {
    render(
      <ProfileMovedBanner
        acct={null}
        href={null}
        external={false}
        isOwner={false}
        isRedirect={false}
      />
    )

    expect(screen.getByText('This profile has moved')).toBeInTheDocument()
    expect(
      screen.queryByText('This profile has moved to')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Go to new profile/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Manage/ })
    ).not.toBeInTheDocument()
  })

  it('keeps the Manage way in for the owner without a stored target', () => {
    render(
      <ProfileMovedBanner
        acct={null}
        href={null}
        external={false}
        isOwner
        isRedirect={false}
      />
    )

    expect(screen.getByRole('link', { name: /Manage/ })).toHaveAttribute(
      'href',
      '/settings/moving'
    )
  })
})
