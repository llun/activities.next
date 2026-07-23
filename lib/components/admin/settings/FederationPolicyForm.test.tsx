/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import { FederationPolicyForm } from './FederationPolicyForm'
import type { ServerSettingLocks } from './InstanceSettingsForm'

const mockUpdate = vi.fn()

vi.mock('@/lib/client', () => ({
  updateAdminServerSettings: (patch: Record<string, unknown>) =>
    mockUpdate(patch)
}))

const settingsWith = (
  federation: ResolvedServerSettings['federation']
): ResolvedServerSettings => ({
  instance: {
    name: 'llun.social',
    description: '',
    contactEmail: '',
    languages: ['en']
  },
  registrations: { open: true, allowEmails: [] },
  posts: { maxCharacters: 500, maxMediaAttachments: 20 },
  polls: {
    maxOptions: 4,
    maxCharactersPerOption: 50,
    minExpirationSeconds: 300,
    maxExpirationSeconds: 2629746
  },
  media: { maxFileSize: 209715200 },
  network: {
    requestTimeoutMs: 4000,
    requestRetries: 1,
    maxResponseSizeBytes: 2097152
  },
  federation
})

const renderForm = (
  federation: ResolvedServerSettings['federation'] = {
    mode: 'open',
    allowActorDomains: []
  },
  locks: ServerSettingLocks = {},
  mediaDomains: string[] = ['files.mastodon.social']
) =>
  render(
    <FederationPolicyForm
      settings={settingsWith(federation)}
      locks={locks}
      mediaDomains={mediaDomains}
    />
  )

describe('FederationPolicyForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({
      settings: settingsWith({ mode: 'open', allowActorDomains: [] }),
      locks: {}
    })
  })

  it('hides the allowed-servers field in open mode', () => {
    renderForm()
    expect(screen.queryByLabelText('Allowed servers')).not.toBeInTheDocument()
  })

  it('reveals the allowed-servers field when switched to allowlist', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Mode'), {
      target: { value: 'allowlist' }
    })
    expect(screen.getByLabelText('Allowed servers')).toBeInTheDocument()
  })

  it('shows trusted media domains read-only and env-pinned', () => {
    renderForm()
    const mediaField = screen.getByLabelText('Trusted media domains')
    expect(mediaField).toBeDisabled()
    expect(mediaField).toHaveValue('files.mastodon.social')
    expect(
      screen.getByText('ACTIVITIES_ALLOW_MEDIA_DOMAINS')
    ).toBeInTheDocument()
  })

  it('saves the mode change', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Mode'), {
      target: { value: 'allowlist' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'federation.mode': 'allowlist' })
      )
    )
  })

  it('locks the mode select when pinned by env', () => {
    renderForm(
      { mode: 'allowlist', allowActorDomains: ['mastodon.social'] },
      {
        'federation.mode': {
          locked: true,
          envVar: 'ACTIVITIES_FEDERATION_MODE'
        }
      }
    )
    expect(screen.getByLabelText('Mode')).toBeDisabled()
    expect(screen.getByText('ACTIVITIES_FEDERATION_MODE')).toBeInTheDocument()
  })
})
