/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/lib/client'

import { StravaSettingsForm } from './StravaSettingsForm'

vi.mock('@/lib/client', () => ({
  getStravaSettings: vi.fn(),
  saveStravaSettings: vi.fn(),
  deleteStravaSettings: vi.fn()
}))

vi.mock('./StravaArchiveImportSection', () => ({
  StravaArchiveImportSection: ({ actorHandle }: { actorHandle?: string }) => (
    <div data-testid="archive-import-section" data-actor-handle={actorHandle} />
  )
}))

const mockGetStravaSettings = vi.mocked(client.getStravaSettings)
const mockSaveStravaSettings = vi.mocked(client.saveStravaSettings)
const mockDeleteStravaSettings = vi.mocked(client.deleteStravaSettings)

describe('StravaSettingsForm', () => {
  const originalLocation = window.location
  let locationHref = 'http://localhost/fitness/strava'
  let locationSearch = ''

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    locationHref = 'http://localhost/fitness/strava'
    locationSearch = ''

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        get href() {
          return locationHref
        },
        set href(val: string) {
          locationHref = val
        },
        get search() {
          return locationSearch
        },
        set search(val: string) {
          locationSearch = val
        },
        pathname: '/fitness/strava',
        hash: ''
      }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('loading', () => {
    it('loads unconfigured settings into form', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: false,
        defaultVisibility: 'private'
      })

      render(<StravaSettingsForm serverActorHandle="@server@example.com" />)

      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      const clientIdInput = screen.getByLabelText(
        /^client id/i
      ) as HTMLInputElement
      const clientSecretInput = screen.getByLabelText(
        /^client secret/i
      ) as HTMLInputElement

      expect(clientIdInput.value).toBe('')
      expect(clientIdInput).not.toBeDisabled()
      expect(clientSecretInput.value).toBe('')
      expect(clientSecretInput).not.toBeDisabled()

      expect(
        screen.getByRole('button', { name: /save and connect/i })
      ).toBeDisabled()
      expect(screen.queryByLabelText(/webhook url/i)).toBeNull()
      expect(screen.queryByText(/connected to strava/i)).toBeNull()

      const archiveSection = screen.getByTestId('archive-import-section')
      expect(archiveSection).toHaveAttribute(
        'data-actor-handle',
        '@server@example.com'
      )
    })

    it('loads configured and connected settings, preserving masked secret', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '998877',
        webhookUrl: 'https://llun.test/api/v1/webhooks/strava/tok123',
        defaultVisibility: 'private',
        actorHandle: '@alice@example.com'
      })

      render(<StravaSettingsForm serverActorHandle="@server@example.com" />)

      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      const clientIdInput = screen.getByLabelText(
        /^client id/i
      ) as HTMLInputElement
      const clientSecretInput = screen.getByLabelText(
        /^client secret/i
      ) as HTMLInputElement
      const webhookUrlInput = screen.getByLabelText(
        /^webhook url/i
      ) as HTMLInputElement

      expect(clientIdInput.value).toBe('998877')
      expect(clientIdInput).toBeDisabled()
      expect(clientSecretInput.value).toBe('••••••••')
      expect(clientSecretInput).toBeDisabled()
      expect(webhookUrlInput.value).toBe(
        'https://llun.test/api/v1/webhooks/strava/tok123'
      )
      expect(webhookUrlInput).toHaveAttribute('readonly')

      expect(screen.getByText('✓ Connected to Strava')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /save visibility/i })
      ).toBeInTheDocument()

      const archiveSection = screen.getByTestId('archive-import-section')
      expect(archiveSection).toHaveAttribute(
        'data-actor-handle',
        '@alice@example.com'
      )
    })

    it('displays warning when credentials are saved but not connected', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: false,
        clientId: '998877',
        defaultVisibility: 'private'
      })

      render(<StravaSettingsForm />)

      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      expect(
        screen.getByText(
          'Credentials saved but not connected. Please reconnect.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('✓ Connected to Strava')).toBeNull()
    })

    it('shows success message from URL search params and cleans up URL', async () => {
      locationSearch = '?success=true'
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '12345',
        defaultVisibility: 'private'
      })
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

      render(<StravaSettingsForm />)

      expect(
        await screen.findByText('Successfully connected to Strava!')
      ).toBeInTheDocument()
      expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/fitness/strava')
    })

    it.each([
      {
        param: 'authorization_failed',
        expected: 'Authorization was denied or failed'
      },
      {
        param: 'webhook_subscription_failed',
        expected: 'Failed to create webhook subscription. Please try again.'
      },
      {
        param: 'other_reason',
        expected: 'Failed to connect to Strava'
      }
    ])(
      'shows error message for URL error param "$param"',
      async ({ param, expected }) => {
        locationSearch = `?error=${param}`
        mockGetStravaSettings.mockResolvedValueOnce({
          configured: false,
          defaultVisibility: 'private'
        })
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

        render(<StravaSettingsForm />)

        expect(await screen.findByText(expected)).toBeInTheDocument()
        expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/fitness/strava')
      }
    )
  })

  describe('cancellation', () => {
    it('treats aborts as cancellation rather than visible failure', async () => {
      mockGetStravaSettings.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            const abortError = new Error('The user aborted a request.')
            abortError.name = 'AbortError'
            reject(abortError)
          })
      )

      render(<StravaSettingsForm />)

      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      expect(screen.queryByText('Failed to load settings')).toBeNull()
    })
  })

  describe('loading failure', () => {
    it('displays error message when settings request rejects', async () => {
      mockGetStravaSettings.mockRejectedValueOnce(
        new Error('Network error loading settings')
      )

      render(<StravaSettingsForm />)

      expect(
        await screen.findByText('Failed to load settings')
      ).toBeInTheDocument()
    })
  })

  describe('saving', () => {
    it('submits clientId, clientSecret, and defaultVisibility when not configured', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: false,
        defaultVisibility: 'private'
      })
      mockSaveStravaSettings.mockResolvedValueOnce({
        success: true,
        message: 'Strava settings saved successfully!'
      })

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      const clientIdInput = screen.getByLabelText(/^client id/i)
      const clientSecretInput = screen.getByLabelText(/^client secret/i)

      fireEvent.change(clientIdInput, { target: { value: '123456' } })
      fireEvent.change(clientSecretInput, { target: { value: 'my-secret' } })

      const submitButton = screen.getByRole('button', {
        name: /save and connect/i
      })
      expect(submitButton).not.toBeDisabled()
      fireEvent.click(submitButton)

      await waitFor(() =>
        expect(mockSaveStravaSettings).toHaveBeenCalledWith({
          clientId: '123456',
          clientSecret: 'my-secret',
          defaultVisibility: 'private'
        })
      )

      expect(
        await screen.findByText('Strava settings saved successfully!')
      ).toBeInTheDocument()
      expect(
        (screen.getByLabelText(/^client secret/i) as HTMLInputElement).value
      ).toBe('••••••••')
      expect(screen.getByLabelText(/^client id/i)).toBeDisabled()
    })

    it('submits only defaultVisibility when already configured', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '123456',
        defaultVisibility: 'private'
      })
      mockSaveStravaSettings.mockResolvedValueOnce({
        success: true,
        message: 'Strava import visibility saved successfully'
      })

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      // Change visibility using dropdown
      fireEvent.keyDown(
        screen.getByRole('button', { name: /set visibility/i }),
        { key: 'ArrowDown' }
      )
      const unlistedOption = await screen.findByRole('menuitemradio', {
        name: /unlisted/i
      })
      fireEvent.click(unlistedOption)

      const saveButton = screen.getByRole('button', {
        name: /save visibility/i
      })
      fireEvent.click(saveButton)

      await waitFor(() =>
        expect(mockSaveStravaSettings).toHaveBeenCalledWith({
          defaultVisibility: 'unlisted'
        })
      )

      expect(
        await screen.findByText('Strava import visibility saved successfully')
      ).toBeInTheDocument()
    })

    it('shows loading state while saving is in progress', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: false,
        defaultVisibility: 'private'
      })
      let resolveSave: (value: { success: boolean; message: string }) => void
      mockSaveStravaSettings.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve
          })
      )

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.change(screen.getByLabelText(/^client id/i), {
        target: { value: '123456' }
      })
      fireEvent.change(screen.getByLabelText(/^client secret/i), {
        target: { value: 'secret' }
      })

      fireEvent.click(screen.getByRole('button', { name: /save and connect/i }))

      expect(
        screen.getByRole('button', { name: /saving\.\.\./i })
      ).toBeDisabled()

      resolveSave!({ success: true, message: 'Saved!' })

      expect(await screen.findByText('Saved!')).toBeInTheDocument()
    })
  })

  describe('redirect responses', () => {
    it('redirects to Strava authorization URL when returned from save', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: false,
        defaultVisibility: 'private'
      })
      mockSaveStravaSettings.mockResolvedValueOnce({
        success: true,
        message: 'Strava settings saved successfully',
        authorizeUrl: '/api/v1/fitness/strava/authorize'
      })

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.change(screen.getByLabelText(/^client id/i), {
        target: { value: '123456' }
      })
      fireEvent.change(screen.getByLabelText(/^client secret/i), {
        target: { value: 'secret' }
      })

      fireEvent.click(screen.getByRole('button', { name: /save and connect/i }))

      expect(
        await screen.findByText('Redirecting to Strava for authorization...')
      ).toBeInTheDocument()
      expect(locationHref).toBe('/api/v1/fitness/strava/authorize')
    })
  })

  describe('saving failure', () => {
    it('displays error message when saving fails', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: false,
        defaultVisibility: 'private'
      })
      mockSaveStravaSettings.mockRejectedValueOnce(
        new Error('Client ID must be numeric')
      )

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.change(screen.getByLabelText(/^client id/i), {
        target: { value: '123456' }
      })
      fireEvent.change(screen.getByLabelText(/^client secret/i), {
        target: { value: 'secret' }
      })

      fireEvent.click(screen.getByRole('button', { name: /save and connect/i }))

      expect(
        await screen.findByText('Client ID must be numeric')
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /save and connect/i })
      ).not.toBeDisabled()
    })
  })

  describe('unlinking', () => {
    it('opens confirmation dialog and cancels without calling API', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '123456',
        defaultVisibility: 'private'
      })

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }))

      expect(
        await screen.findByText('Unlink Strava Integration')
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          /are you sure you want to remove your strava integration\?/i
        )
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      await waitFor(() => {
        expect(
          screen.queryByText('Unlink Strava Integration')
        ).not.toBeInTheDocument()
      })
      expect(mockDeleteStravaSettings).not.toHaveBeenCalled()
    })

    it('unlinks integration, resets form state, and provides feedback', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '123456',
        webhookUrl: 'https://llun.test/webhook',
        defaultVisibility: 'unlisted'
      })
      mockDeleteStravaSettings.mockResolvedValueOnce({
        success: true,
        message: 'Strava settings removed successfully'
      })

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }))

      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      // The confirm button in DialogFooter is the second Unlink button
      const allUnlinkButtons = screen.getAllByRole('button', {
        name: /^unlink$/i
      })
      const dialogUnlinkButton = allUnlinkButtons[allUnlinkButtons.length - 1]
      fireEvent.click(dialogUnlinkButton)

      await waitFor(() => expect(mockDeleteStravaSettings).toHaveBeenCalled())

      expect(
        await screen.findByText('Strava settings removed successfully')
      ).toBeInTheDocument()

      const clientIdInput = screen.getByLabelText(
        /^client id/i
      ) as HTMLInputElement
      const clientSecretInput = screen.getByLabelText(
        /^client secret/i
      ) as HTMLInputElement

      expect(clientIdInput.value).toBe('')
      expect(clientIdInput).not.toBeDisabled()
      expect(clientSecretInput.value).toBe('')
      expect(clientSecretInput).not.toBeDisabled()
      expect(screen.queryByLabelText(/webhook url/i)).toBeNull()
      expect(screen.queryByText(/connected to strava/i)).toBeNull()
      expect(
        screen.getByRole('button', { name: /save and connect/i })
      ).toBeInTheDocument()
    })

    it('displays error message when unlinking fails', async () => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '123456',
        defaultVisibility: 'private'
      })
      mockDeleteStravaSettings.mockRejectedValueOnce(
        new Error('Failed to remove settings')
      )

      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }))

      const allUnlinkButtons = screen.getAllByRole('button', {
        name: /^unlink$/i
      })
      fireEvent.click(allUnlinkButtons[allUnlinkButtons.length - 1])

      expect(
        await screen.findByText('Failed to remove settings')
      ).toBeInTheDocument()
    })
  })

  describe('import visibility disclosure', () => {
    const renderFormWithVisibility = async (visibility?: string) => {
      mockGetStravaSettings.mockResolvedValueOnce({
        configured: true,
        connected: true,
        clientId: '12345',
        webhookUrl: 'https://llun.test/api/v1/webhooks/strava/token',
        ...(visibility
          ? { defaultVisibility: visibility as any }
          : { defaultVisibility: 'private' })
      })
      render(<StravaSettingsForm />)
      await waitFor(() => expect(mockGetStravaSettings).toHaveBeenCalled())
    }

    it('says that an activity marked Only you on Strava is posted at this visibility', async () => {
      await renderFormWithVisibility('private')

      const helper = await screen.findByText(
        /Every activity imported from Strava/
      )
      expect(helper).toHaveTextContent('Only you')
      expect(helper).toHaveTextContent(
        /never carried over|is never carried over/
      )
    })

    it('says the setting covers retries and repairs, not just the webhook', async () => {
      await renderFormWithVisibility('private')

      const helper = await screen.findByText(
        /Every activity imported from Strava/
      )
      expect(helper).toHaveTextContent(/retry or repair/)
    })

    it('does not label the control as webhook-only', async () => {
      await renderFormWithVisibility('private')

      expect(
        await screen.findByText('Automatic import visibility')
      ).toBeVisible()
      expect(screen.queryByText('Webhook Activity Visibility')).toBeNull()
    })

    it.each([
      { description: 'warns when imports are public', visibility: 'public' },
      { description: 'warns when imports are unlisted', visibility: 'unlisted' }
    ])('$description', async ({ visibility }) => {
      await renderFormWithVisibility(visibility)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Anyone on the fediverse can read')
      expect(alert).toHaveTextContent('Only you')
    })

    it.each([
      { description: 'stays quiet for followers-only', visibility: 'private' },
      { description: 'stays quiet for direct', visibility: 'direct' }
    ])('$description', async ({ visibility }) => {
      await renderFormWithVisibility(visibility)

      await screen.findByText(/Every activity imported from Strava/)
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
