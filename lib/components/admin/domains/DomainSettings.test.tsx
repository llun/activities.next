/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MockInstance } from 'vitest'

import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'

import { DomainSettings } from './DomainSettings'

const mockUpdate = vi.fn()
const mockSetStatus = vi.fn()
const mockCheck = vi.fn()
const mockRemove = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/client/adminDomains')
  >('@/lib/client/adminDomains')
  return {
    AdminDomainRequestError: actual.AdminDomainRequestError,
    updateAdminDomainRegistrations: (...args: unknown[]) => mockUpdate(...args),
    setAdminDomainStatus: (...args: unknown[]) => mockSetStatus(...args),
    checkAdminDomain: (...args: unknown[]) => mockCheck(...args),
    removeAdminDomain: (...args: unknown[]) => mockRemove(...args)
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() })
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({
    title,
    description
  }: {
    title: React.ReactNode
    description: React.ReactNode
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}))

const RUN: AdminDomain = {
  domain: 'run.example',
  source: 'database',
  name: null,
  status: 'on',
  profiles: 34,
  signupsOpen: true,
  allowedEmails: ['ana@mail.example'],
  allowExistingUsers: true,
  lastCheckedAt: Date.UTC(2026, 9, 18),
  lastCheck: {
    passed: true,
    reason: 'passed',
    items: [
      { key: 'dns', status: 'passed' },
      { key: 'tls', status: 'passed' },
      { key: 'host', status: 'passed' }
    ]
  }
}

const renderPage = (domain: AdminDomain) =>
  render(<DomainSettings domain={domain} primaryDomain="social.example" />)

describe('DomainSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockSetStatus.mockReset()
    mockCheck.mockReset()
    mockRemove.mockReset()
    mockPush.mockReset()
  })

  it('shows the header with its badges and the profile count', () => {
    renderPage(RUN)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /run\.example.*Reachable.*On/
    )
    expect(screen.getByText(/run\.example · 34 profiles/)).toBeInTheDocument()
  })

  it('saves the Registrations box', async () => {
    mockUpdate.mockImplementation(async (_domain, values) => ({
      ...RUN,
      ...values
    }))
    renderPage(RUN)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByRole('switch', { name: 'Sign-ups open' }))
    fireEvent.change(screen.getByLabelText('Allowed email addresses'), {
      target: { value: 'ana@mail.example\nben@mail.example' }
    })
    fireEvent.click(save)

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('run.example', {
        signupsOpen: false,
        allowedEmails: ['ana@mail.example', 'ben@mail.example'],
        allowExistingUsers: true
      })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('keeps "Existing users can add profiles" on for an env domain and never sends it', async () => {
    mockUpdate.mockImplementation(async () => ({ ...RUN, source: 'env' }))
    renderPage({ ...RUN, source: 'env', lastCheck: null })
    const existing = screen.getByRole('switch', {
      name: 'Existing users can add profiles here'
    })
    expect(existing).toBeChecked()
    expect(existing).toBeDisabled()
    expect(
      screen.getByText(
        /joined through another domain can add a profile here only while this domain's sign-ups would admit them/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/is set in ACTIVITIES_TRUSTED_HOSTS, so it is always on/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Sign-ups open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('allowExistingUsers')
  })

  it('sends the primary to Instance and says it cannot be turned off', () => {
    renderPage({ ...RUN, domain: 'social.example', source: 'primary' })
    expect(screen.getByRole('link', { name: 'Open Instance' })).toHaveAttribute(
      'href',
      '/admin/instance'
    )
    expect(
      screen.getByText(
        'The primary domain, social.example, can’t be turned off.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn off/ })).toBeNull()
  })

  it('turns an added domain off, then on again', async () => {
    mockSetStatus.mockImplementation(async (_domain, status) => ({
      ...RUN,
      status
    }))
    renderPage(RUN)
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn off run.example' })
    )
    await waitFor(() =>
      expect(mockSetStatus).toHaveBeenCalledWith('run.example', 'off')
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Turn on run.example' })
    )
    await waitFor(() =>
      expect(mockSetStatus).toHaveBeenCalledWith('run.example', 'on')
    )
  })

  it('shows the failed check when turning on is refused', async () => {
    const { AdminDomainRequestError } =
      await import('@/lib/client/adminDomains')
    const failed: AdminDomain = {
      ...RUN,
      status: 'off',
      lastCheck: {
        passed: false,
        reason: 'host-header',
        items: [
          { key: 'dns', status: 'passed' },
          { key: 'tls', status: 'passed' },
          { key: 'host', status: 'failed' }
        ]
      }
    }
    mockSetStatus.mockRejectedValue(
      new AdminDomainRequestError(
        'The domain did not pass the check, so it stays off.',
        'check-failed',
        failed
      )
    )
    renderPage({ ...RUN, status: 'off' })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on run.example' }))
    expect(
      await screen.findByText(
        'The domain did not pass the check, so it stays off.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('run.example does not reach this server')
    ).toBeInTheDocument()
    // A request failure is an Alert whose Retry repeats the turn on.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockSetStatus).toHaveBeenCalledTimes(2))
    expect(mockSetStatus).toHaveBeenLastCalledWith('run.example', 'on')
  })

  it('retries a failed turn off as a turn off', async () => {
    mockSetStatus.mockRejectedValue(new Error('Failed to change the domain.'))
    renderPage(RUN)
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn off run.example' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockSetStatus).toHaveBeenCalledTimes(2))
    expect(mockSetStatus).toHaveBeenLastCalledWith('run.example', 'off')
  })

  it('retries a failed remove as a remove', async () => {
    mockRemove.mockRejectedValue(new Error('Failed to remove the domain.'))
    renderPage({ ...RUN, status: 'off', profiles: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(2))
    expect(mockSetStatus).not.toHaveBeenCalled()
  })

  it('removes an off domain with no profiles', async () => {
    mockRemove.mockResolvedValue(undefined)
    renderPage({ ...RUN, status: 'off', profiles: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/domains'))
  })

  it('offers no Remove while the domain has profiles', () => {
    renderPage({ ...RUN, status: 'off' })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('checks again', async () => {
    mockCheck.mockResolvedValue({
      ...RUN,
      lastCheck: { ...RUN.lastCheck!, passed: false, reason: 'other-server' }
    })
    renderPage(RUN)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(
      await screen.findByText('run.example does not reach this server')
    ).toBeInTheDocument()
  })

  it('shows a failed check request as an Alert that checks again', async () => {
    mockCheck.mockRejectedValue(new Error('Failed to check the domain.'))
    renderPage(RUN)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to check the domain.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2))
  })

  // The last check ran at midnight UTC on 18 Oct, 8 PM on 17 Oct in New York.
  it('hydrates the server-rendered UTC check time without a mismatch, then shows local time', async () => {
    await withTimeZone('America/New_York', async () => {
      let consoleError: MockInstance<typeof console.error> | undefined
      let hydrated: Awaited<ReturnType<typeof hydrateServerHtml>> | undefined
      try {
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        hydrated = await hydrateServerHtml(
          <DomainSettings domain={RUN} primaryDomain="social.example" />
        )

        expect(hydrated.serverHtml).toContain('Oct 18, 2026, 12:00 AM')
        expect(hydrated.onRecoverableError).not.toHaveBeenCalled()
        expect(consoleError).not.toHaveBeenCalled()
        expect(hydrated.container).toHaveTextContent(
          'Last checked Oct 17, 2026, 8:00 PM.'
        )
        expect(hydrated.container.querySelector('time')).toHaveAttribute(
          'datetime',
          '2026-10-18T00:00:00.000Z'
        )
      } finally {
        consoleError?.mockRestore()
        hydrated?.unmount()
      }
    })
  })
})
