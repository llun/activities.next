/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AdminDomainDetail } from '@/lib/services/domains/adminDomainTypes'
import type { FeatureFlags } from '@/lib/services/domains/domainFeatures'

import { DomainFeaturesBox } from './DomainFeaturesBox'

const mockSave = vi.fn()

vi.mock('@/lib/client', () => ({
  updateAdminDomainFeatures: (...args: unknown[]) => mockSave(...args)
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
  profiles: 1,
  signupsOpen: true,
  allowedEmails: [],
  allowExistingUsers: true,
  lastCheckedAt: null,
  lastCheck: null
}

const ALL_ON: FeatureFlags = { fitness: true, explore: true, messages: true }

describe('DomainFeaturesBox', () => {
  beforeEach(() => {
    mockSave.mockReset()
  })

  it('shows a switch per feature, on unless the domain turned it off', () => {
    render(
      <DomainFeaturesBox
        domain={{ ...RUN, disabledFeatures: ['explore'] }}
        serverFeatures={ALL_ON}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('switch', { name: /Fitness/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /Explore/ })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /Messages/ })).toBeChecked()
    expect(
      screen.getByText('Workouts, routes and the Fitness page.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'A domain can turn off what the server has on, never the reverse.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save features' })).toBeDisabled()
  })

  it('saves the whole list of turned-off features', async () => {
    const saved = { ...RUN, disabledFeatures: ['fitness' as const] }
    mockSave.mockResolvedValue(saved)
    const onSaved = vi.fn()
    render(
      <DomainFeaturesBox
        domain={RUN}
        serverFeatures={ALL_ON}
        onSaved={onSaved}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /Fitness/ }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }))
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('run.example', {
        disabledFeatures: ['fitness']
      })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(saved)
  })

  it('turning a feature back on removes it from the list', async () => {
    mockSave.mockResolvedValue({ ...RUN, disabledFeatures: ['messages'] })
    render(
      <DomainFeaturesBox
        domain={{ ...RUN, disabledFeatures: ['explore', 'messages'] }}
        serverFeatures={ALL_ON}
        onSaved={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /Explore/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }))
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('run.example', {
        disabledFeatures: ['messages']
      })
    )
  })

  it('shows a feature the server has off as off and disabled, with a way to turn it on', () => {
    render(
      <DomainFeaturesBox
        domain={RUN}
        serverFeatures={{ ...ALL_ON, messages: false }}
        onSaved={vi.fn()}
      />
    )
    const messages = screen.getByRole('switch', { name: /Messages/ })
    expect(messages).not.toBeChecked()
    expect(messages).toBeDisabled()
    expect(screen.getByText('Turned off on the server')).toBeInTheDocument()
    expect(screen.getByText(/Turn it on in/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instance' })).toHaveAttribute(
      'href',
      '/admin/instance'
    )
    // The other two stay editable and the server-off one is never sent.
    fireEvent.click(screen.getByRole('switch', { name: /Fitness/ }))
    expect(screen.getByRole('switch', { name: /Explore/ })).toBeEnabled()
  })

  it('does not send a server-off feature the domain never turned off', async () => {
    mockSave.mockResolvedValue({ ...RUN, disabledFeatures: ['fitness'] })
    render(
      <DomainFeaturesBox
        domain={RUN}
        serverFeatures={{ ...ALL_ON, messages: false }}
        onSaved={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /Fitness/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }))
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('run.example', {
        disabledFeatures: ['fitness']
      })
    )
  })

  it('shows the error from a failed save and keeps the changes', async () => {
    mockSave.mockRejectedValue(new Error('The server said no.'))
    render(
      <DomainFeaturesBox
        domain={RUN}
        serverFeatures={ALL_ON}
        onSaved={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /Explore/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }))
    expect(await screen.findByText('The server said no.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Explore/ })).not.toBeChecked()
  })

  describe('primary domain', () => {
    const PRIMARY = {
      ...RUN,
      domain: 'social.example',
      source: 'primary' as const
    }

    it('shows On and Off badges with no switches or save bar, and points to Instance', () => {
      render(
        <DomainFeaturesBox
          domain={PRIMARY}
          serverFeatures={{ ...ALL_ON, messages: false }}
          onSaved={vi.fn()}
        />
      )
      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save features' })).toBeNull()
      expect(screen.getAllByText('On')).toHaveLength(2)
      expect(screen.getAllByText('Off')).toHaveLength(1)
      expect(
        screen.getByText('The primary domain follows the server’s switches.')
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Edit on Instance' })
      ).toHaveAttribute('href', '/admin/instance')
    })
  })
})
