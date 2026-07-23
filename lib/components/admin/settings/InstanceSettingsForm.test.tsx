/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
    maxResponseSizeBytes: 2097152
  },
  federation: { mode: 'open', allowActorDomains: [] }
}

const renderForm = (locks: ServerSettingLocks = {}) =>
  render(<InstanceSettingsForm settings={baseSettings} locks={locks} />)

describe('InstanceSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({ settings: baseSettings, locks: {} })
  })

  it('renders the initial values', () => {
    renderForm()
    expect(screen.getByLabelText('Instance name')).toHaveValue('llun.social')
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('ไทย')).toBeInTheDocument()
    expect(screen.getByText('Registrations are open')).toBeInTheDocument()
  })

  it('saves only the edited instance-details keys', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Instance name'), {
      target: { value: 'New Name' }
    })

    // Two sections → two Update buttons; details is the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0])

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
})
