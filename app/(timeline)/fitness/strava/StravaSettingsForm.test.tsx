/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StravaSettingsForm } from './StravaSettingsForm'

// The form calls `fetch` directly rather than going through `lib/client`, so
// the global is what has to be stubbed here.
const stubSettingsResponse = (defaultVisibility?: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        configured: true,
        connected: true,
        clientId: '12345',
        webhookUrl: 'https://llun.test/api/v1/webhooks/strava/token',
        ...(defaultVisibility ? { defaultVisibility } : {})
      })
    })
  )
}

const renderForm = async (defaultVisibility?: string) => {
  stubSettingsResponse(defaultVisibility)
  render(<StravaSettingsForm />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
}

describe('StravaSettingsForm import visibility', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // The whole point of the disclosure: before it, the only user-facing copy
  // said imports "will use this visibility" and never mentioned that Strava's
  // own per-activity privacy is discarded.
  it('says that an activity marked Only you on Strava is posted at this visibility', async () => {
    await renderForm('private')

    const helper = await screen.findByText(
      /Every activity imported from Strava/
    )
    expect(helper).toHaveTextContent('Only you')
    expect(helper).toHaveTextContent(/never carried over|is never carried over/)
  })

  it('says the setting covers retries and repairs, not just the webhook', async () => {
    await renderForm('private')

    const helper = await screen.findByText(
      /Every activity imported from Strava/
    )
    expect(helper).toHaveTextContent(/retry or repair/)
  })

  // "Webhook Activity Visibility" understated the scope — the same stored
  // value is what a retry and the repair scripts post at.
  it('does not label the control as webhook-only', async () => {
    await renderForm('private')

    expect(await screen.findByText('Automatic import visibility')).toBeVisible()
    expect(screen.queryByText('Webhook Activity Visibility')).toBeNull()
  })

  it.each([
    { description: 'warns when imports are public', visibility: 'public' },
    { description: 'warns when imports are unlisted', visibility: 'unlisted' }
  ])('$description', async ({ visibility }) => {
    await renderForm(visibility)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Anyone on the fediverse can read')
    expect(alert).toHaveTextContent('Only you')
  })

  it.each([
    { description: 'stays quiet for followers-only', visibility: 'private' },
    { description: 'stays quiet for direct', visibility: 'direct' }
  ])('$description', async ({ visibility }) => {
    await renderForm(visibility)

    await screen.findByText(/Every activity imported from Strava/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
