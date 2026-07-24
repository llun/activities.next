/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import { MAX_CONFIGURABLE_FILE_SIZE } from '@/lib/services/medias/constants'

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

const storageBackend = {
  label: 'S3 — media.example.social',
  detail: 'eu-central-1'
}

const renderForm = (locks: ServerSettingLocks = {}) =>
  render(
    <PostsMediaSettingsForm
      settings={baseSettings}
      locks={locks}
      storageBackend={storageBackend}
    />
  )

describe('PostsMediaSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({ settings: baseSettings, locks: {} })
  })

  it('renders initial post and media values', () => {
    renderForm()
    expect(screen.getByLabelText('Post size')).toHaveValue(500)
    expect(screen.getByLabelText('Upload size limit')).toHaveValue(200)
  })

  // The backend is infrastructure read from the environment at boot, so it is
  // reported with an env-lock badge rather than offered as an editable control.
  it('reports the storage backend read-only', () => {
    renderForm()
    expect(screen.getByText('Storage backend')).toBeInTheDocument()
    expect(screen.getByText('S3 — media.example.social')).toBeInTheDocument()
    expect(screen.getByText('(eu-central-1)')).toBeInTheDocument()

    // Assert on controls, not on label association: the section's only control
    // is the upload-size input, so a storage-backend control of any kind fails
    // this. A queryByLabelText would not — the field has no `htmlFor`, and the
    // env badge sits inside the label, so it never resolves either way.
    const mediaSection = screen
      .getByRole('heading', { name: 'Media' })
      .closest('section')
    expect(mediaSection).not.toBeNull()
    const controls = (mediaSection as HTMLElement).querySelectorAll(
      'input, select, textarea'
    )
    expect(controls).toHaveLength(1)
    expect(controls[0]).toHaveAttribute('id', 'media-max-file-size')
  })

  it('omits the parenthesised detail when the backend has none', () => {
    render(
      <PostsMediaSettingsForm
        settings={baseSettings}
        locks={{}}
        storageBackend={{ label: 'Local filesystem — ./uploads' }}
      />
    )
    expect(screen.getByText('Local filesystem — ./uploads')).toBeInTheDocument()
    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument()
  })

  it('keeps its own help on the storage backend instead of the pinned-by line', () => {
    renderForm()
    expect(
      screen.getByText(/change it with the builder below/, { exact: false })
    ).toBeInTheDocument()
    expect(screen.getByText('Set by environment')).toHaveAttribute(
      'title',
      'ACTIVITIES_MEDIA_STORAGE_*'
    )
  })

  it('renders the environment block builder below the saved settings', () => {
    renderForm()
    expect(screen.getByLabelText('Environment area')).toBeInTheDocument()
    expect(screen.getByLabelText('Storage type')).toBeInTheDocument()
  })

  it('saves the edited post limits', async () => {
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

  // Regression: 500 MB used to be refused with a 422 because the setting was
  // capped at the 200 MiB built-in default.
  it('saves an upload limit above the built-in default', async () => {
    renderForm()
    const input = screen.getByLabelText('Upload size limit')
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[2])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'media.maxFileSize': 500 * 1024 * 1024 })
      )
    )
  })

  it('clamps an upload limit above the ceiling instead of sending a 422', async () => {
    renderForm()
    const input = screen.getByLabelText('Upload size limit')
    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.blur(input)

    const maxMb = MAX_CONFIGURABLE_FILE_SIZE / (1024 * 1024)
    expect(input).toHaveValue(maxMb)

    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[2])
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          'media.maxFileSize': MAX_CONFIGURABLE_FILE_SIZE
        })
      )
    )
  })
})
