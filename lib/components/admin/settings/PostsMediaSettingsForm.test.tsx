/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import type { ServerSettingLocks } from './InstanceSettingsForm'
import { PostsMediaSettingsForm } from './PostsMediaSettingsForm'

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
    maxResponseSizeBytes: 2097152
  },
  federation: { mode: 'open', allowActorDomains: [] }
}

const renderForm = (
  locks: ServerSettingLocks = {},
  settings: ResolvedServerSettings = baseSettings
) =>
  render(
    <PostsMediaSettingsForm
      settings={settings}
      locks={locks}
      storageBackend="S3-compatible storage"
    />
  )

describe('PostsMediaSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({ settings: baseSettings, locks: {} })
  })

  it('renders initial post and media values', () => {
    renderForm()
    expect(screen.getByLabelText('Post size')).toHaveValue('500')
    expect(screen.getByLabelText('Upload size limit')).toHaveValue(200)
    expect(screen.getByLabelText('Storage backend')).toHaveValue(
      'S3-compatible storage'
    )
  })

  it('saves the post size picked from the presets', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: '1000' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'posts.maxCharacters': 1000 })
      )
    )
  })

  it('keeps the custom post size input hidden while a preset is selected', () => {
    renderForm()
    expect(screen.queryByLabelText('Custom post size')).not.toBeInTheDocument()
  })

  it('saves a custom post size entered after picking Custom', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: 'custom' }
    })
    fireEvent.change(screen.getByLabelText('Custom post size'), {
      target: { value: '750' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'posts.maxCharacters': 750 })
      )
    )
  })

  it('starts on Custom when the stored post size is not a preset', () => {
    renderForm(
      {},
      { ...baseSettings, posts: { ...baseSettings.posts, maxCharacters: 750 } }
    )
    expect(screen.getByLabelText('Post size')).toHaveValue('custom')
    expect(screen.getByLabelText('Custom post size')).toHaveValue(750)
  })

  it('stays on Custom when a typed value happens to match a preset', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: 'custom' }
    })
    fireEvent.change(screen.getByLabelText('Custom post size'), {
      target: { value: '1000' }
    })

    expect(screen.getByLabelText('Post size')).toHaveValue('custom')
    expect(screen.getByLabelText('Custom post size')).toHaveValue(1000)
  })

  it('converts the upload limit from MB to bytes on save', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Upload size limit'), {
      target: { value: '50' }
    })
    // Media is the third section.
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[2])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'media.maxFileSize': 50 * 1024 * 1024 })
      )
    )
  })

  it('always shows the storage backend as read-only and env-pinned', () => {
    renderForm()
    expect(screen.getByLabelText('Storage backend')).toBeDisabled()
    expect(screen.getByText('Set by environment')).toBeInTheDocument()
  })
})
