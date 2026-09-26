/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { WahooSettingsForm } from './WahooSettingsForm'

vi.mock('@/lib/client', () => ({
  getWahooSettings: vi.fn(),
  saveWahooSettings: vi.fn(),
  deleteWahooSettings: vi.fn()
}))

vi.mock('./WahooHistorySection', () => ({
  WahooHistorySection: () => <div>History panel</div>
}))

vi.mock('./WahooFailedImportsSection', () => ({
  WahooFailedImportsSection: () => <div>Failed imports panel</div>
}))

const settings: client.WahooSettingsResponse = {
  configured: true,
  clientId: 'client-example',
  hasClientSecret: true,
  hasWebhookToken: true,
  connected: true,
  environment: 'sandbox',
  defaultVisibility: 'private',
  callbackUrl: 'https://example.test/api/v1/settings/fitness/wahoo/callback',
  webhookUrl: 'https://example.test/api/v1/webhooks/wahoo/',
  automaticImportAvailable: true
}

describe('WahooSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/fitness/wahoo')
    vi.mocked(client.getWahooSettings).mockResolvedValue(settings)
    vi.mocked(client.saveWahooSettings).mockResolvedValue({ success: true })
  })

  it('keeps saved secrets out of the page and omits blank replacements on save', async () => {
    render(<WahooSettingsForm />)

    await screen.findByDisplayValue('client-example')
    expect(screen.getByLabelText('Client secret')).toHaveValue('')
    expect(screen.getByLabelText('Webhook token')).toHaveValue('')
    expect(screen.getByLabelText('Callback URL')).toHaveValue(
      settings.callbackUrl
    )
    expect(screen.getByLabelText('Webhook URL')).toHaveValue(
      settings.webhookUrl
    )

    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/api/v1/settings/fitness/wahoo/authorize'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(client.saveWahooSettings).toHaveBeenCalledWith({
        clientId: 'client-example',
        environment: 'sandbox',
        defaultVisibility: 'private'
      })
    )
    expect(screen.getByText('No webhook received yet')).toBeInTheDocument()
    expect(screen.getByText('No successful import yet')).toBeInTheDocument()
  })

  it('shows the last webhook and successful import times', async () => {
    vi.mocked(client.getWahooSettings).mockResolvedValue({
      ...settings,
      lastWebhookAt: '2026-09-22T14:30:00.000Z',
      lastImportAt: '2026-09-22T14:32:00.000Z'
    })

    render(<WahooSettingsForm />)

    await screen.findByText(/Last successful import:/)
    const times = document.querySelectorAll('time')
    expect(times).toHaveLength(2)
    expect(times[0]).toHaveAttribute('dateTime', '2026-09-22T14:30:00.000Z')
    expect(times[1]).toHaveAttribute('dateTime', '2026-09-22T14:32:00.000Z')
    expect(times[0]).not.toBeEmptyDOMElement()
    expect(times[1]).not.toBeEmptyDOMElement()
  })

  it('labels provider connection failures as Wahoo errors', async () => {
    vi.mocked(client.getWahooSettings).mockResolvedValue({
      ...settings,
      lastError: 'OAuth authorization was denied'
    })

    render(<WahooSettingsForm />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wahoo error: OAuth authorization was denied'
    )
  })

  it.each([
    [
      'wahoo_account_already_connected',
      'This Wahoo account and webhook token are already connected to another profile.'
    ],
    [
      'credentials_changed',
      'Wahoo settings changed during authorization. Please connect again.'
    ]
  ])('explains the %s callback error', async (code, message) => {
    window.history.replaceState({}, '', `/fitness/wahoo?error=${code}`)

    render(<WahooSettingsForm />)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(window.location.search).toBe('')
  })
})
