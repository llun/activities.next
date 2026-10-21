/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MockInstance } from 'vitest'

import type {
  AdminDomainDetail,
  ServerIdentityView
} from '@/lib/services/domains/adminDomainTypes'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'

import { type DomainPageScope, DomainSettings } from './DomainSettings'

const mockUpdate = vi.fn()
const mockIdentity = vi.fn()
const mockPolicies = vi.fn()
const mockSetStatus = vi.fn()
const mockCheck = vi.fn()
const mockRemove = vi.fn()
const mockPush = vi.fn()
const mockFeatures = vi.fn()
const mockCreateRule = vi.fn()
const mockUpdateRule = vi.fn()
const mockDeleteRule = vi.fn()
const mockGetRules = vi.fn()

vi.mock('@/lib/client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/client/adminDomains')
  >('@/lib/client/adminDomains')
  return {
    AdminDomainRequestError: actual.AdminDomainRequestError,
    updateAdminDomainIdentity: (...args: unknown[]) => mockIdentity(...args),
    updateAdminDomainPolicies: (...args: unknown[]) => mockPolicies(...args),
    updateAdminDomainRegistrations: (...args: unknown[]) => mockUpdate(...args),
    setAdminDomainStatus: (...args: unknown[]) => mockSetStatus(...args),
    checkAdminDomain: (...args: unknown[]) => mockCheck(...args),
    removeAdminDomain: (...args: unknown[]) => mockRemove(...args),
    updateAdminDomainFeatures: (...args: unknown[]) => mockFeatures(...args),
    createServerRule: (...args: unknown[]) => mockCreateRule(...args),
    updateServerRule: (...args: unknown[]) => mockUpdateRule(...args),
    deleteServerRule: (...args: unknown[]) => mockDeleteRule(...args),
    getServerRules: (...args: unknown[]) => mockGetRules(...args)
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

const RUN: AdminDomainDetail = {
  domain: 'run.example',
  source: 'database',
  name: null,
  description: null,
  contactEmail: null,
  termsOfService: null,
  privacyPolicy: null,
  termsOfServiceUpdatedAt: null,
  privacyPolicyUpdatedAt: null,
  disabledFeatures: [],
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

const SERVER: ServerIdentityView = {
  name: 'Activities',
  description: 'Posts from the server.',
  contactEmail: 'hello@social.example',
  contactAccount: '@llun@social.example',
  terms: { set: true, updatedAt: Date.UTC(2026, 9, 12, 12) },
  privacy: { set: false, updatedAt: null }
}

const rule = (overrides: Partial<AdminRule>): AdminRule => ({
  id: 'rule-1',
  domain: null,
  text: 'Be kind to everyone',
  hint: '',
  position: 0,
  ...overrides
})

const SCOPE: DomainPageScope = {
  serverRules: [
    rule({ id: 's1' }),
    rule({ id: 's2', text: 'No spam', position: 1 })
  ],
  ownRules: [],
  announcements: [],
  allDomainsAnnouncements: 0,
  serverFeatures: { fitness: true, explore: true, messages: true },
  openReports: 0,
  currentTime: Date.UTC(2026, 9, 21)
}

const renderPage = (
  domain: AdminDomainDetail,
  scope: Partial<DomainPageScope> = {}
) =>
  render(
    <DomainSettings
      domain={domain}
      primaryDomain="social.example"
      server={SERVER}
      scope={{ ...SCOPE, ...scope }}
    />
  )

describe('DomainSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockIdentity.mockReset()
    mockPolicies.mockReset()
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
    for (const link of screen.getAllByRole('link', {
      name: 'Open Instance'
    })) {
      expect(link).toHaveAttribute('href', '/admin/instance')
    }
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
    const failed: AdminDomainDetail = {
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

  describe('Identity', () => {
    const OWN: AdminDomainDetail = {
      ...RUN,
      name: 'Run Club',
      description: 'Runners.',
      contactEmail: 'hello@run.example'
    }

    it('shows the server values disabled while "Same as server" is on', () => {
      renderPage(RUN)
      expect(
        screen.getByText(
          'What visitors to run.example see as the name of this server.'
        )
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveValue('Activities')
      expect(screen.getByLabelText('Name')).toBeDisabled()
      expect(screen.getByLabelText('Contact email')).toHaveValue(
        'hello@social.example'
      )
      expect(screen.getByText('@llun@social.example')).toBeInTheDocument()
      expect(screen.getByText('Same for every domain.')).toBeInTheDocument()
      expect(
        // Identity, Terms and privacy, Rules and Features each say it.
        screen.getAllByText('Changes apply to run.example only.')
      ).toHaveLength(4)
      expect(
        screen.getByRole('button', { name: 'Save identity' })
      ).toBeDisabled()
    })

    it('keeps the draft text when the switch is toggled', () => {
      renderPage(OWN)
      const name = screen.getByLabelText('Name')
      fireEvent.change(name, { target: { value: 'Run Crew' } })
      const same = screen.getByRole('switch', {
        name: 'Name: Same as server'
      })
      fireEvent.click(same)
      expect(screen.getByLabelText('Name')).toHaveValue('Activities')
      expect(screen.getByLabelText('Name')).toBeDisabled()
      fireEvent.click(same)
      expect(screen.getByLabelText('Name')).toHaveValue('Run Crew')
    })

    it('blocks a blank override and says why', () => {
      renderPage(RUN)
      fireEvent.click(
        screen.getByRole('switch', { name: 'Name: Same as server' })
      )
      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(
        screen.getByRole('button', { name: 'Save identity' })
      ).toBeDisabled()
      expect(
        screen.getByText(/Enter a value or use Same as server/)
      ).toBeInTheDocument()
    })

    it('saves trimmed text and null for Same as server', async () => {
      mockIdentity.mockImplementation(async (_domain, values) => ({
        ...RUN,
        ...values
      }))
      renderPage(RUN)
      fireEvent.click(
        screen.getByRole('switch', { name: 'Name: Same as server' })
      )
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: '  Run Club ' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save identity' }))
      await waitFor(() =>
        expect(mockIdentity).toHaveBeenCalledWith('run.example', {
          name: 'Run Club',
          description: null,
          contactEmail: null
        })
      )
      expect(await screen.findByText('Saved')).toBeInTheDocument()
    })

    it('sends null for a field that is switched back to Same as server', async () => {
      mockIdentity.mockImplementation(async (_domain, values) => ({
        ...OWN,
        ...values
      }))
      renderPage(OWN)
      fireEvent.click(
        screen.getByRole('switch', { name: 'Description: Same as server' })
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save identity' }))
      await waitFor(() =>
        expect(mockIdentity).toHaveBeenCalledWith('run.example', {
          name: 'Run Club',
          description: null,
          contactEmail: 'hello@run.example'
        })
      )
    })
  })

  describe('Terms and privacy', () => {
    it('says what the server has and links to Instance', () => {
      renderPage(RUN)
      expect(
        screen.getByText(
          'Shown on run.example/terms-of-service and run.example/privacy-policy and linked from sign-up.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName === 'P' &&
            el.textContent ===
              'Using the server terms of service. Last updated 12 Oct 2026. Edit on Instance'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText(/The server has no privacy policy\./)
      ).toBeInTheDocument()
      expect(
        screen.getAllByRole('link', { name: 'Edit on Instance' })
      ).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: 'Save policies' })
      ).toBeDisabled()
    })

    it('keeps the draft text when the switch is toggled', () => {
      renderPage({ ...RUN, termsOfService: '# Own terms' })
      const textarea = screen.getByLabelText('Terms of service')
      fireEvent.change(textarea, { target: { value: '# Edited' } })
      const same = screen.getByRole('switch', {
        name: 'Terms of service: Same as server'
      })
      fireEvent.click(same)
      expect(screen.queryByLabelText('Terms of service')).toBeNull()
      fireEvent.click(same)
      expect(screen.getByLabelText('Terms of service')).toHaveValue('# Edited')
    })

    it('blocks a blank override', () => {
      renderPage(RUN)
      fireEvent.click(
        screen.getByRole('switch', { name: 'Privacy policy: Same as server' })
      )
      expect(
        screen.getByRole('button', { name: 'Save policies' })
      ).toBeDisabled()
      expect(
        screen.getByText(/Enter a value or use Same as server/)
      ).toBeInTheDocument()
    })

    it('saves its own text and null for the other policy', async () => {
      mockPolicies.mockImplementation(async (_domain, values) => ({
        ...RUN,
        ...values,
        termsOfServiceUpdatedAt: Date.UTC(2026, 9, 20, 12)
      }))
      renderPage(RUN)
      fireEvent.click(
        screen.getByRole('switch', { name: 'Terms of service: Same as server' })
      )
      fireEvent.change(screen.getByLabelText('Terms of service'), {
        target: { value: '# Terms' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save policies' }))
      await waitFor(() =>
        expect(mockPolicies).toHaveBeenCalledWith('run.example', {
          termsOfService: '# Terms',
          privacyPolicy: null
        })
      )
      expect(await screen.findByText('Saved')).toBeInTheDocument()
      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName === 'P' &&
            el.textContent === 'Markdown. Last updated 20 Oct 2026.'
        )
      ).toBeInTheDocument()
    })
  })

  describe('primary domain', () => {
    const PRIMARY: AdminDomainDetail = {
      ...RUN,
      domain: 'social.example',
      source: 'primary'
    }

    it('shows an info alert above read-only boxes with no save bars', () => {
      renderPage(PRIMARY)
      const alert = screen.getByText(
        'The primary domain uses the server’s identity, terms and privacy, rules and features.'
      )
      expect(
        screen.getByText(
          'Edit them on Admin › Instance, and the rules on Admin › Server rules.'
        )
      ).toBeInTheDocument()
      const identity = screen.getByRole('heading', { name: 'Identity' })
      expect(
        alert.compareDocumentPosition(identity) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(screen.getByLabelText('Name')).toBeDisabled()
      expect(screen.getByLabelText('Name')).toHaveValue('Activities')
      expect(
        screen.queryByRole('switch', { name: /Same as server/ })
      ).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save identity' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save policies' })).toBeNull()
    })
  })

  describe('step 5 boxes', () => {
    const headings = () =>
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)

    it('adds Rules, Announcements, Features and Reports after Terms and privacy, before Turn off domain', () => {
      renderPage(RUN)
      const names = headings()
      const order = [
        'Terms and privacy',
        'Rules',
        'Announcements',
        'Features',
        'Reports',
        'Turn off domain'
      ]
      expect(names.filter((name) => order.includes(name ?? ''))).toEqual(order)
    })

    it('gives an added domain editable rules, feature switches and its counts', () => {
      renderPage(RUN, {
        openReports: 3,
        allDomainsAnnouncements: 1,
        ownRules: [
          rule({
            id: 'o1',
            domain: 'run.example',
            text: 'Own rule',
            position: 0
          })
        ]
      })
      expect(screen.getByRole('textbox', { name: 'Rule 3 text' })).toHaveValue(
        'Own rule'
      )
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Save features' })
      ).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: /Fitness/ })).toBeEnabled()
      expect(
        screen.getByText('3 open reports about profiles on run.example')
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Also showing 1 announcement for all domains/)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'New announcement for run.example' })
      ).toHaveAttribute('href', '/admin/announcements?domain=run.example')
    })

    it('shows a server-off feature locked on the domain page', () => {
      renderPage(RUN, {
        serverFeatures: { fitness: true, explore: true, messages: false }
      })
      expect(screen.getByRole('switch', { name: /Messages/ })).toBeDisabled()
      expect(screen.getByText('Turned off on the server')).toBeInTheDocument()
    })

    it('saves the domain features', async () => {
      mockFeatures.mockResolvedValue({ ...RUN, disabledFeatures: ['explore'] })
      renderPage(RUN)
      fireEvent.click(screen.getByRole('switch', { name: /Explore/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Save features' }))
      await waitFor(() =>
        expect(mockFeatures).toHaveBeenCalledWith('run.example', {
          disabledFeatures: ['explore']
        })
      )
    })

    it('keeps the primary domain read-only: server rules, On/Off badges, no save bars', () => {
      renderPage(
        { ...RUN, domain: 'social.example', source: 'primary' },
        {
          openReports: 1,
          serverFeatures: { fitness: true, explore: false, messages: true }
        }
      )
      expect(
        screen.getByText(
          'The primary domain has no rules of its own. These are the server rules.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save features' })).toBeNull()
      expect(
        screen.getByRole('link', { name: 'Edit on Instance' })
      ).toBeInTheDocument()
      // Announcements and Reports stay available on the primary.
      expect(
        screen.getByRole('link', {
          name: 'New announcement for social.example'
        })
      ).toBeInTheDocument()
      expect(
        screen.getByText('1 open report about profiles on social.example')
      ).toBeInTheDocument()
    })

    it('shows the same boxes for an env domain', () => {
      renderPage({ ...RUN, source: 'env' })
      expect(screen.getByRole('button', { name: 'Save rules' })).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Save features' })
      ).toBeVisible()
    })
  })

  // The last check ran at midnight UTC on 18 Oct, 8 PM on 17 Oct in New York.
  it('hydrates the server-rendered UTC check time without a mismatch, then shows local time', async () => {
    await withTimeZone('America/New_York', async () => {
      let consoleError: MockInstance<typeof console.error> | undefined
      let hydrated: Awaited<ReturnType<typeof hydrateServerHtml>> | undefined
      try {
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        hydrated = await hydrateServerHtml(
          <DomainSettings
            domain={RUN}
            primaryDomain="social.example"
            server={SERVER}
            scope={SCOPE}
          />
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
