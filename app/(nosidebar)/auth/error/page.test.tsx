/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { logger } from '@/lib/utils/logger'

import Page from './page'

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn() }
}))

const renderPage = async (params: Record<string, string | string[]>) => {
  render(await Page({ searchParams: Promise.resolve(params) }))
}

describe('/auth/error', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  it("explains a known oauth-provider failure in the visitor's terms", async () => {
    await renderPage({ error: 'invalid_client' })

    expect(
      screen.getByText("This app isn't registered here")
    ).toBeInTheDocument()
    expect(screen.getByText('invalid_client')).toBeInTheDocument()
  })

  it('falls back to generic copy for an unmapped code', async () => {
    await renderPage({ error: 'brand_new_code' })

    expect(
      screen.getByText("We couldn't complete that sign-in")
    ).toBeInTheDocument()
  })

  // The whole point of owning this page: better-auth's own error page echoes
  // error_description, and anyone can put anything in it by linking here.
  it('never renders the attacker-supplied error_description', async () => {
    await renderPage({
      error: 'invalid_client',
      error_description:
        'Your account was suspended. Call 1-800-555-0100 to restore it.'
    })

    expect(screen.queryByText(/1-800-555-0100/)).not.toBeInTheDocument()
    expect(screen.queryByText(/suspended/i)).not.toBeInTheDocument()
  })

  it('drops an error code that is not token-shaped instead of echoing it', async () => {
    await renderPage({ error: 'contact support at evil.example' })

    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()
    expect(
      screen.getByText("We couldn't complete that sign-in")
    ).toBeInTheDocument()
  })

  // Token-shaped is not the same as known. This lure passes the character
  // class and the length cap, so only the allow-list keeps it off the card.
  it('never echoes a token-shaped code that is not one we emit', async () => {
    await renderPage({ error: 'Account-locked-please-call-1-800-555-0100' })

    expect(screen.queryByText(/1-800-555-0100/)).not.toBeInTheDocument()
    expect(
      screen.getByText("We couldn't complete that sign-in")
    ).toBeInTheDocument()
  })

  it('takes the first value when error_description is repeated', async () => {
    await renderPage({
      error: 'invalid_client',
      error_description: ['first cause', 'second cause']
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorDescription: 'first cause' })
    )
  })

  // An unknown code is still worth logging (a better-auth upgrade can add one)
  // but its description is unbounded caller text on an unauthenticated route.
  it('drops the description when the code is not one we emit', async () => {
    await renderPage({
      error: 'made_up_code',
      error_description: 'x'.repeat(500)
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'made_up_code',
        errorDescription: null
      })
    )
  })

  it('always offers a way back to sign in', async () => {
    await renderPage({})

    expect(
      screen.getByRole('link', { name: 'Back to sign in' })
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('logs the missing-parameter fallbacks and shows no technical detail', async () => {
    await renderPage({})

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'unknown', errorDescription: null })
    )
    // The fallbacks are for the log only — 'unknown' must never reach the card.
    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
    expect(document.querySelector('code')).toBeNull()
  })

  it('logs the failure so an operator can correlate it', async () => {
    await renderPage({
      error: 'client_disabled',
      error_description: 'client is disabled'
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'client_disabled',
        errorDescription: 'client is disabled'
      })
    )
  })

  it('truncates a long error_description before logging it', async () => {
    await renderPage({
      error: 'invalid_request',
      error_description: 'x'.repeat(500)
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorDescription: 'x'.repeat(200) })
    )
  })
})
