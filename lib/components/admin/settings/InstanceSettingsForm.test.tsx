/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import {
  InstanceSettingsForm,
  ServerSettingLocks
} from './InstanceSettingsForm'

const mockUpdate = vi.fn()

vi.mock('@/lib/client', () => ({
  updateAdminServerSettings: (patch: Record<string, unknown>) =>
    mockUpdate(patch)
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>
}))

const baseSettings: ResolvedServerSettings = {
  instance: {
    name: 'llun.social',
    description: 'A friendly place.',
    contactEmail: 'admin@llun.social',
    languages: ['en', 'th']
  },
  registrations: { open: true, allowEmails: ['anna@llun.dev'] },
  policies: { termsOfService: '', privacyPolicy: '' },
  posts: { maxCharacters: 500, maxMediaAttachments: 20 },
  polls: {
    maxOptions: 4,
    maxCharactersPerOption: 50,
    minExpirationSeconds: 300,
    maxExpirationSeconds: 2678400
  },
  media: { maxFileSize: 209715200 },
  network: {
    requestTimeoutMs: 4000,
    requestRetries: 1,
    maxResponseSizeBytes: 2097152,
    linkPreviews: true,
    speciesLookups: true,
    placeLookups: true
  },
  federation: { mode: 'open', allowActorDomains: [] },
  features: { fitness: true, explore: true, messages: true }
}

const renderForm = (
  locks: ServerSettingLocks = {},
  updatedAt: Record<string, number | null> = {},
  settings: ResolvedServerSettings = baseSettings
) =>
  render(
    <InstanceSettingsForm
      settings={settings}
      locks={locks}
      updatedAt={updatedAt}
    />
  )

const withPolicies = (
  policies: ResolvedServerSettings['policies']
): ResolvedServerSettings => ({ ...baseSettings, policies })

describe('InstanceSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({
      settings: baseSettings,
      locks: {},
      updatedAt: {}
    })
  })

  it('renders the initial values', () => {
    renderForm()
    expect(screen.getByLabelText('Instance name')).toHaveValue('llun.social')
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('ไทย')).toBeInTheDocument()
    expect(screen.getByText('Registrations are open')).toBeInTheDocument()
  })

  describe('optional features', () => {
    it.each([['Fitness'], ['Explore'], ['Messages']])(
      'shows %s as available by default',
      (label) => {
        renderForm()
        expect(screen.getByLabelText(label)).toBeChecked()
      }
    )

    it('saves only the feature keys when a feature is turned off', async () => {
      renderForm()
      fireEvent.click(screen.getByLabelText('Fitness'))

      const saveButtons = screen.getAllByRole('button', { name: 'Save' })
      fireEvent.click(saveButtons[saveButtons.length - 1])

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith({
          'features.fitness': false,
          'features.explore': true,
          'features.messages': true
        })
      )
    })
  })

  it('saves only the edited instance-details keys', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Instance name'), {
      target: { value: 'New Name' }
    })

    // One Save button per section; details is the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'instance.name': 'New Name' })
      )
    )
    // Registration keys are not part of the details patch.
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch).not.toHaveProperty('registrations.open')
  })

  it('disables an env-locked field and shows the badge', () => {
    renderForm({
      'instance.name': { locked: true, envVar: 'ACTIVITIES_SERVICE_NAME' }
    })
    expect(screen.getByLabelText('Instance name')).toBeDisabled()
    expect(screen.getByText('Set by environment')).toBeInTheDocument()
    expect(screen.getByText('ACTIVITIES_SERVICE_NAME')).toBeInTheDocument()
  })

  it('surfaces the server error message when a save fails', async () => {
    mockUpdate.mockRejectedValueOnce(
      new Error('Some settings could not be saved')
    )
    renderForm()
    fireEvent.change(screen.getByLabelText('Instance name'), {
      target: { value: 'New Name' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() =>
      expect(
        screen.getByText('Some settings could not be saved')
      ).toBeInTheDocument()
    )
    // Still dirty (the value was not adopted), so Save stays enabled.
    expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeEnabled()
  })

  it('names the languages group by its label and describes it by the hint', () => {
    renderForm()

    const languages = screen.getByRole('group', { name: 'Languages' })
    expect(languages).toHaveAccessibleDescription(
      /Primary languages of this instance/
    )
    // The chips live inside the group the row names.
    expect(within(languages).getByText('English')).toBeInTheDocument()
    expect(within(languages).getByText('ไทย')).toBeInTheDocument()
  })

  it('adopts the server-resolved values and clears dirty after a save', async () => {
    mockUpdate.mockResolvedValueOnce({
      settings: {
        ...baseSettings,
        instance: { ...baseSettings.instance, name: 'New Name' }
      },
      locks: {}
    })
    renderForm()
    fireEvent.change(screen.getByLabelText('Instance name'), {
      target: { value: 'New Name' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeDisabled()
  })

  describe('terms and privacy', () => {
    const TERMS_KEY = 'policies.termsOfService'
    const PRIVACY_KEY = 'policies.privacyPolicy'
    const saveButton = () =>
      screen.getByRole('button', { name: 'Save terms and privacy' })

    it('shows both documents in monospace boxes with the section copy', () => {
      renderForm(
        {},
        { [TERMS_KEY]: Date.UTC(2026, 9, 12, 8) },
        withPolicies({ termsOfService: '# Terms', privacyPolicy: '# Privacy' })
      )

      expect(
        screen.getByText("Used by every domain that doesn't set its own.")
      ).toBeInTheDocument()
      const terms = screen.getByLabelText('Terms of service')
      expect(terms).toHaveValue('# Terms')
      expect(terms).toHaveAttribute('rows', '16')
      expect(terms).toHaveClass('font-mono')
      expect(screen.getByLabelText('Privacy policy')).toHaveValue('# Privacy')
      expect(
        screen.getByText(
          'Changes apply to every domain that uses the server terms.'
        )
      ).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('says when the terms last changed, in UTC, and nothing for an undated one', () => {
      renderForm(
        {},
        { [TERMS_KEY]: Date.UTC(2026, 9, 12, 8), [PRIVACY_KEY]: null }
      )

      expect(screen.getByText(/Markdown\.\s+Last updated/)).toHaveTextContent(
        'Markdown. Last updated 12 Oct 2026.'
      )
      expect(screen.getAllByText(/Markdown\./)).toHaveLength(2)
      expect(screen.getAllByText(/Last updated/)).toHaveLength(1)
      expect(
        screen.getByLabelText('Terms of service')
      ).toHaveAccessibleDescription('Markdown. Last updated 12 Oct 2026.')
    })

    it('saves only the policy keys and shows the refreshed date', async () => {
      mockUpdate.mockResolvedValueOnce({
        settings: withPolicies({
          termsOfService: '# New terms',
          privacyPolicy: ''
        }),
        locks: {},
        updatedAt: {
          [TERMS_KEY]: Date.UTC(2026, 9, 20, 9),
          [PRIVACY_KEY]: null
        }
      })
      renderForm()
      expect(screen.queryByText(/Last updated/)).toBeNull()

      fireEvent.change(screen.getByLabelText('Terms of service'), {
        target: { value: '# New terms' }
      })
      expect(saveButton()).toBeEnabled()
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith({
          [TERMS_KEY]: '# New terms',
          [PRIVACY_KEY]: ''
        })
      )
      await waitFor(() =>
        expect(screen.getByText(/Last updated/)).toHaveTextContent(
          'Last updated 20 Oct 2026'
        )
      )
      expect(screen.getByText('Saved')).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('keeps the old date when the save fails', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('Could not save'))
      renderForm({}, { [TERMS_KEY]: Date.UTC(2026, 9, 12) })

      fireEvent.change(screen.getByLabelText('Terms of service'), {
        target: { value: 'x' }
      })
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(screen.getByText('Could not save')).toBeInTheDocument()
      )
      expect(screen.getByText(/Last updated/)).toHaveTextContent('12 Oct 2026')
    })

    it('locks an env-pinned document with the badge and the warning, and no date', () => {
      renderForm(
        {
          [PRIVACY_KEY]: { locked: true, envVar: 'ACTIVITIES_PRIVACY_POLICY' }
        },
        { [PRIVACY_KEY]: Date.UTC(2026, 9, 12) },
        withPolicies({ termsOfService: '', privacyPolicy: '# Privacy' })
      )

      expect(screen.getByLabelText(/^Privacy policy/)).toBeDisabled()
      expect(screen.getByLabelText('Terms of service')).toBeEnabled()
      expect(screen.getByText('Set by environment')).toBeInTheDocument()
      const alert = screen.getByText('Set by ACTIVITIES_PRIVACY_POLICY.')
      expect(alert).toBeInTheDocument()
      expect(
        screen.getByText('Remove the variable to edit it here.')
      ).toBeInTheDocument()
      expect(screen.queryByText(/Last updated/)).toBeNull()
      expect(document.getElementById('policies-privacy-help')).toBeNull()
      expect(document.getElementById('policies-terms-help')).not.toBeNull()
    })

    it('saves the unlocked document alone while the other is pinned', async () => {
      renderForm(
        {
          [PRIVACY_KEY]: { locked: true, envVar: 'ACTIVITIES_PRIVACY_POLICY' }
        },
        {},
        withPolicies({ termsOfService: '', privacyPolicy: '# Privacy' })
      )

      fireEvent.change(screen.getByLabelText('Terms of service'), {
        target: { value: '# New terms' }
      })
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith({ [TERMS_KEY]: '# New terms' })
      )
    })
  })

  it('leaves an env-locked key out of the details patch', async () => {
    renderForm({
      'instance.name': { locked: true, envVar: 'ACTIVITIES_SERVICE_NAME' }
    })
    fireEvent.change(screen.getByLabelText('Short description'), {
      target: { value: 'New description' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch).toHaveProperty('instance.description', 'New description')
    expect(patch).not.toHaveProperty('instance.name')
  })
})
