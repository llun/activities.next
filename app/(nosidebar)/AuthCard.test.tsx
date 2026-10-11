/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Alert } from '@/lib/components/surface/Alert'

import {
  AuthCard,
  AuthCardActions,
  AuthCardBody,
  AuthCardFooter
} from './AuthCard'

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
      container.querySelector('[data-slot="auth-card-actions"]')
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

  it("renders the footer in the action band, the card's one top border", () => {
    const { container } = render(
      <AuthCard title="Hello" footer={<AuthCardFooter>Links</AuthCardFooter>} />
    )

    const band = container.querySelector('[data-slot="auth-card-actions"]')
    expect(band).toHaveTextContent('Links')
    expect(band).toHaveClass('border-t', 'px-6', 'py-5', 'grid', 'gap-3')
    // Only the link line is centred and muted, not the whole band.
    expect(screen.getByText('Links')).toHaveClass(
      'text-center',
      'text-sm',
      'text-muted-foreground'
    )
  })

  it('stacks the body fields in a px-6 column, with no inner frame', () => {
    const { container } = render(
      <AuthCard title="Hello">
        <AuthCardBody>
          <input aria-label="Email" />
        </AuthCardBody>
      </AuthCard>
    )

    expect(container.querySelector('[data-slot="auth-card-body"]')).toHaveClass(
      'space-y-4',
      'px-6',
      'pt-6',
      'pb-6'
    )
    expect(container.querySelectorAll('[data-slot="frame"]')).toHaveLength(1)
  })

  it('keeps the submit button inside a form that wraps body and actions', () => {
    render(
      <AuthCard title="Hello">
        <form aria-label="Sign in">
          <AuthCardBody>
            <input aria-label="Email" />
          </AuthCardBody>
          <AuthCardActions>
            <button type="submit">Go</button>
          </AuthCardActions>
        </form>
      </AuthCard>
    )

    expect(screen.getByRole('form')).toContainElement(
      screen.getByRole('button', { name: 'Go' })
    )
  })

  it('keeps its bottom padding when there is no body and no footer', () => {
    render(<AuthCard title="Nothing to follow" description="Open a link." />)
    const header = screen.getByRole('heading', { level: 1 }).parentElement
    expect(header).toHaveClass('p-6')
    expect(header).not.toHaveClass('pb-0')
  })

  it('drops the header bottom padding when a body or footer follows', () => {
    const { unmount } = render(
      <AuthCard title="Body">
        <AuthCardBody>Fields</AuthCardBody>
      </AuthCard>
    )
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveClass(
      'pb-0'
    )
    unmount()
    render(<AuthCard title="Footer" footer={<span>Links</span>} />)
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveClass(
      'pb-0'
    )
  })

  it('leaves the action band at normal text colour so an Alert in it is not muted or centred', () => {
    render(
      <AuthCardActions>
        <Alert title="Passkey sign in failed" />
        <AuthCardFooter>Sign up</AuthCardFooter>
      </AuthCardActions>
    )
    const band = document.querySelector('[data-slot="auth-card-actions"]')
    expect(band).not.toHaveClass('text-center')
    expect(band).not.toHaveClass('text-muted-foreground')
    expect(screen.getByText('Sign up')).toHaveClass(
      'text-center',
      'text-muted-foreground'
    )
    expect(band).toHaveClass('empty:hidden')
  })
})
