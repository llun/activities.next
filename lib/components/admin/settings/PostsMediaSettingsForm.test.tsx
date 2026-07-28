/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import { MAX_CONFIGURABLE_FILE_SIZE } from '@/lib/services/medias/constants'
import type { MediaStorageBackendSummary } from '@/lib/services/medias/storageBackendSummary'

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
  replyByEmail: { enabled: true },
  network: {
    requestTimeoutMs: 4000,
    requestRetries: 1,
    maxResponseSizeBytes: 2097152
  },
  federation: { mode: 'open', allowActorDomains: [] }
}

const baseStorageBackend: MediaStorageBackendSummary = {
  label: 'S3 — media.example.social',
  detail: 'eu-central-1'
}

const renderForm = (
  locks: ServerSettingLocks = {},
  settings: ResolvedServerSettings = baseSettings,
  storageBackend: MediaStorageBackendSummary = baseStorageBackend,
  email: { outbound?: boolean; inbound?: boolean } = {}
) =>
  render(
    <PostsMediaSettingsForm
      settings={settings}
      locks={locks}
      storageBackend={storageBackend}
      emailConfigured={email.outbound ?? true}
      emailInboundConfigured={email.inbound ?? true}
    />
  )

const settingsWithReplyByEmail = (
  enabled: boolean
): ResolvedServerSettings => ({
  ...baseSettings,
  replyByEmail: { ...baseSettings.replyByEmail, enabled }
})

describe('PostsMediaSettingsForm', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue({ settings: baseSettings, locks: {} })
  })

  it('renders initial post and media values', () => {
    renderForm()
    expect(screen.getByLabelText('Post size')).toHaveValue('500')
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
    renderForm({}, baseSettings, { label: 'Local filesystem — ./uploads' })
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

  // Typing 5000 passes through 500, a preset. Recomputing the mode from the
  // value would unmount the input mid-edit and strand the admin at 500.
  it('keeps the custom input mounted while typing past a preset value', () => {
    renderForm(
      {},
      { ...baseSettings, posts: { ...baseSettings.posts, maxCharacters: 750 } }
    )

    for (const typed of ['5', '50', '500', '5000']) {
      fireEvent.change(screen.getByLabelText('Custom post size'), {
        target: { value: typed }
      })
      expect(screen.getByLabelText('Post size')).toHaveValue('custom')
    }

    expect(screen.getByLabelText('Custom post size')).toHaveValue(5000)
  })

  // A save adopts whatever the server resolves to, which can differ from what
  // was sent (a concurrent edit by another admin). The orphaned preset must not
  // come back to life when the value is typed back to it.
  it('does not reselect a stale preset after a save resolves elsewhere', async () => {
    mockUpdate.mockResolvedValue({
      settings: {
        ...baseSettings,
        posts: { ...baseSettings.posts, maxCharacters: 750 }
      },
      locks: {}
    })
    renderForm()

    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: '1000' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0])

    await waitFor(() =>
      expect(screen.getByLabelText('Post size')).toHaveValue('custom')
    )
    expect(screen.getByLabelText('Custom post size')).toHaveValue(750)

    fireEvent.change(screen.getByLabelText('Custom post size'), {
      target: { value: '1000' }
    })

    expect(screen.getByLabelText('Post size')).toHaveValue('custom')
    expect(screen.getByLabelText('Custom post size')).toHaveValue(1000)
  })

  it('selects the matching preset when a save resolves to another preset', async () => {
    mockUpdate.mockResolvedValue({
      settings: {
        ...baseSettings,
        posts: { ...baseSettings.posts, maxCharacters: 5000 }
      },
      locks: {}
    })
    renderForm()

    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: '1000' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0])

    await waitFor(() =>
      expect(screen.getByLabelText('Post size')).toHaveValue('5000')
    )
    expect(screen.queryByLabelText('Custom post size')).not.toBeInTheDocument()
  })

  it('switches back from Custom to a preset', () => {
    renderForm(
      {},
      { ...baseSettings, posts: { ...baseSettings.posts, maxCharacters: 750 } }
    )
    fireEvent.change(screen.getByLabelText('Post size'), {
      target: { value: '500' }
    })

    expect(screen.getByLabelText('Post size')).toHaveValue('500')
    expect(screen.queryByLabelText('Custom post size')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'New posts and edits are capped at 500 characters. Links always count as 23.'
      )
    ).toBeInTheDocument()
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

  it('saves the reply-by-email kill switch', async () => {
    renderForm()
    expect(screen.getByLabelText(/Reply by email is/)).toBeChecked()

    fireEvent.click(screen.getByLabelText(/Reply by email is/))
    // Reply by email is the fourth section.
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[3])

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ 'replyByEmail.enabled': false })
    )
  })

  // Shown rather than hidden so an admin finds the setting and learns why it is
  // inert. Locking only ever applies to turning ON something inert.
  it('disables the reply-by-email switch when it is already off and unavailable', () => {
    renderForm({}, settingsWithReplyByEmail(false), baseStorageBackend, {
      inbound: false
    })

    const toggle = screen.getByLabelText(/Reply by email is unavailable/)
    expect(toggle).toBeDisabled()
    expect(toggle).not.toBeChecked()
    expect(
      screen.getByText(/This instance cannot receive replies/)
    ).toBeInTheDocument()
  })

  // The setting is a cluster-wide DB row that defaults to on, so THIS process
  // missing the variables says nothing about the rest of the fleet. Reporting a
  // stored `true` as `false`, or locking it, would put the kill switch out of
  // reach of the pod the admin happens to be talking to.
  it('keeps a stored-on switch readable and writable while unavailable', () => {
    renderForm({}, settingsWithReplyByEmail(true), baseStorageBackend, {
      inbound: false
    })

    const toggle = screen.getByLabelText(
      /Reply by email is allowed, but unavailable here/
    )
    expect(toggle).toBeChecked()
    expect(toggle).not.toBeDisabled()
    expect(
      screen.getByText(/switch it off here to stop them/)
    ).toBeInTheDocument()
  })

  it('lets the admin turn a stored-on switch off while unavailable', async () => {
    renderForm({}, settingsWithReplyByEmail(true), baseStorageBackend, {
      inbound: false
    })

    fireEvent.click(
      screen.getByLabelText(/Reply by email is allowed, but unavailable here/)
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' }).at(-1)!)

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ 'replyByEmail.enabled': false })
    )
  })

  it('keeps the switch usable once both halves of email are configured', () => {
    renderForm()

    const toggle = screen.getByLabelText(/Reply by email is allowed/)
    expect(toggle).not.toBeDisabled()
    expect(toggle).toBeChecked()
  })

  // Naming both halves when only one is missing sends the admin to re-check
  // what is already set — and the builder below cannot assemble the outbound
  // half at all, so pointing at it would be a dead end.
  it('names the outbound half when only outbound email is missing', () => {
    renderForm({}, settingsWithReplyByEmail(false), baseStorageBackend, {
      outbound: false
    })

    expect(screen.getByText('outbound email')).toBeInTheDocument()
    expect(screen.queryByText('inbound email')).toBeNull()
    expect(screen.queryByText(/Build the block with/)).toBeNull()
  })

  it('names the inbound half and points at the builder when inbound is missing', () => {
    renderForm({}, settingsWithReplyByEmail(false), baseStorageBackend, {
      inbound: false
    })

    expect(screen.getByText('inbound email')).toBeInTheDocument()
    expect(screen.getByText(/Build the block with/)).toBeInTheDocument()
  })
})
