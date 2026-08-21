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

import type { ServerSettingLocks } from './InstanceSettingsForm'
import { NetworkSettingsForm } from './NetworkSettingsForm'

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
    maxExpirationSeconds: 2678400
  },
  media: { maxFileSize: 209715200 },
  network: {
    requestTimeoutMs: 4000,
    requestRetries: 1,
    maxResponseSizeBytes: 2097152,
    linkPreviews: true
  },
  federation: { mode: 'open', allowActorDomains: [] },
  features: { fitness: true, explore: true, messages: true }
}

const renderForm = (locks: ServerSettingLocks = {}) =>
  render(<NetworkSettingsForm settings={baseSettings} locks={locks} />)

// Each section saves independently, so every one has its own Update button.
const updateButtonFor = (sectionTitle: string) => {
  const heading = screen.getByRole('heading', { name: sectionTitle })
  const section = heading.closest('section') ?? heading.parentElement
  if (!section) throw new Error(`No section found for ${sectionTitle}`)
  return within(section as HTMLElement).getByRole('button', { name: 'Update' })
}

describe('NetworkSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({ settings: baseSettings, locks: {} })
  })

  it('renders initial request tuning values', () => {
    renderForm()
    expect(screen.getByLabelText('Timeout')).toHaveValue(4000)
    expect(screen.getByLabelText('Retries')).toHaveValue(1)
    expect(screen.getByLabelText('Response size cap')).toHaveValue(2)
  })

  it('saves the edited timeout', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Timeout'), {
      target: { value: '8000' }
    })
    fireEvent.click(updateButtonFor('Advanced — outbound requests'))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'network.requestTimeoutMs': 8000 })
      )
    )
  })

  it('saves the link preview switch on its own, without the request tuning', async () => {
    renderForm()
    fireEvent.click(screen.getByLabelText('Fetch link previews'))
    fireEvent.click(updateButtonFor('Link previews'))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ 'network.linkPreviews': false })
    )
  })

  it('disables an env-locked field and shows the badge', () => {
    renderForm({
      'network.requestTimeoutMs': {
        locked: true,
        envVar: 'ACTIVITIES_REQUEST_TIMEOUT'
      }
    })
    expect(screen.getByLabelText('Timeout')).toBeDisabled()
    expect(screen.getByText('ACTIVITIES_REQUEST_TIMEOUT')).toBeInTheDocument()
  })
})
