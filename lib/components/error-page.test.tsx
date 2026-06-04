/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ErrorPage, errorBoundaryMeta } from '@/lib/components/error-page'

describe('ErrorPage', () => {
  it('renders the 404 page by default with its hero code, reason and copy', () => {
    render(<ErrorPage />)

    expect(
      screen.getByRole('heading', { name: "We couldn't find that page" })
    ).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('404 · not found')).toBeInTheDocument()
  })

  it('renders the giant status code for a wired error code', () => {
    render(<ErrorPage code="500" />)

    expect(screen.getByText('500')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Something went wrong on our end' })
    ).toBeInTheDocument()
  })

  it('renders a glyph instead of a number for the generic fallback', () => {
    render(<ErrorPage code="generic" />)

    expect(
      screen.getByRole('heading', { name: "Something isn't working" })
    ).toBeInTheDocument()
    // The fallback has no numeric hero; the eyebrow reason is still present.
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.queryByText('404')).not.toBeInTheDocument()
  })

  it('overrides the technical-detail line when meta is provided', () => {
    render(<ErrorPage code="500" meta="500 · req-abc123" />)

    expect(screen.getByText('500 · req-abc123')).toBeInTheDocument()
    expect(screen.queryByText('500 · server error')).not.toBeInTheDocument()
  })

  it('falls back to the generic page for an unknown code', () => {
    // @ts-expect-error — exercising the runtime fallback for an invalid code
    render(<ErrorPage code="418" />)

    expect(
      screen.getByRole('heading', { name: "Something isn't working" })
    ).toBeInTheDocument()
  })

  it('does not introduce a <main> landmark (parent layouts own it)', () => {
    render(<ErrorPage code="404" />)

    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })
})

describe('errorBoundaryMeta', () => {
  it('prefers the production-safe digest when present', () => {
    expect(
      errorBoundaryMeta('500', {
        name: 'Error',
        message: 'boom',
        digest: 'abc123'
      })
    ).toBe('500 · abc123')
  })

  it('does not leak the raw message outside development', () => {
    // Jest runs with NODE_ENV=test, so the message branch must stay closed and
    // the boundary falls back to the per-code default meta (undefined here).
    expect(
      errorBoundaryMeta('500', { name: 'Error', message: 'sensitive detail' })
    ).toBeUndefined()
  })
})
