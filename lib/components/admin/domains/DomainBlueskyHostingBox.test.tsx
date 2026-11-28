/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AdminDomainDetail } from '@/lib/services/domains/adminDomainTypes'

import { DomainBlueskyHostingBox } from './DomainBlueskyHostingBox'

const mockSave = vi.fn()

vi.mock('@/lib/client', () => ({
  updateAdminDomainHosting: (...args: unknown[]) => mockSave(...args)
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
  blueskyHostingPolicy: null,
  blueskyHostingAllowEmails: null,
  blueskyHostingAllowActors: null,
  lastCheckedAt: null,
  lastCheck: null
}

const PDS_HOSTNAME = 'pds.run.example'

const renderBox = (domain: AdminDomainDetail = RUN) =>
  render(
    <DomainBlueskyHostingBox
      domain={domain}
      pdsHostname={PDS_HOSTNAME}
      onSaved={vi.fn()}
    />
  )

describe('DomainBlueskyHostingBox', () => {
  beforeEach(() => {
    mockSave.mockReset()
  })

  it('offers the three choices and says the server configuration applies when unset', () => {
    renderBox()

    expect(screen.getByRole('radio', { name: 'Nobody' })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Listed accounts' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Everyone on this domain' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Not set — using the server configuration.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save hosting' })).toBeDisabled()
  })

  it('shows the two lists for Listed and saves them', async () => {
    mockSave.mockResolvedValue({
      ...RUN,
      blueskyHostingPolicy: 'listed',
      blueskyHostingAllowEmails: ['alice@run.example'],
      blueskyHostingAllowActors: ['bob@run.example']
    })
    renderBox()

    fireEvent.click(screen.getByRole('radio', { name: 'Listed accounts' }))

    const emails = screen.getByLabelText('Email addresses')
    const actors = screen.getByLabelText('Profiles')
    fireEvent.change(emails, { target: { value: 'alice@run.example' } })
    fireEvent.change(actors, { target: { value: 'bob@run.example' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save hosting' }))

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('run.example', {
        blueskyHostingPolicy: 'listed',
        blueskyHostingAllowEmails: ['alice@run.example'],
        blueskyHostingAllowActors: ['bob@run.example']
      })
    )
  })

  it('clears a saved policy back to the server configuration', async () => {
    mockSave.mockResolvedValue({ ...RUN, blueskyHostingPolicy: null })
    renderBox({ ...RUN, blueskyHostingPolicy: 'everyone' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Use the server configuration' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save hosting' }))

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('run.example', {
        blueskyHostingPolicy: null,
        blueskyHostingAllowEmails: [],
        blueskyHostingAllowActors: []
      })
    )
  })

  it('explains the wildcard DNS record and certificate for subdomain handles', () => {
    renderBox()

    expect(screen.getByText(/wildcard DNS record for/)).toBeInTheDocument()
    expect(screen.getByText(`*.${PDS_HOSTNAME}`)).toBeInTheDocument()
    expect(screen.getByText(/certificate that covers it/)).toBeInTheDocument()
  })
})
