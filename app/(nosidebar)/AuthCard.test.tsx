/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { AuthCard, AuthCardFooter } from './AuthCard'

describe('AuthCard', () => {
  it("is the screen's one h1, with the description and content under it", () => {
    render(
      <AuthCard
        title="Sign in to Activities"
        description="Your self-hosted corner of the Fediverse."
      >
        <button type="button">Go</button>
      </AuthCard>
    )

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in to Activities' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Your self-hosted corner of the Fediverse.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('draws the logo as decoration, not as content', () => {
    const { container } = render(
      <AuthCard title="Hello" logoSrc="https://activities.local/logo-nav.png" />
    )

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveAttribute('aria-hidden', 'true')
  })

  it('leaves the logo and footer out when there are none', () => {
    const { container } = render(<AuthCard title="Hello" />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="frame-footer"]')
    ).not.toBeInTheDocument()
  })

  it('puts the footer links under the content', () => {
    render(
      <AuthCard
        title="Hello"
        footer={
          <AuthCardFooter>
            Remembered it? <a href="/auth/signin">Sign in</a>
          </AuthCardFooter>
        }
      />
    )

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin'
    )
  })
})
