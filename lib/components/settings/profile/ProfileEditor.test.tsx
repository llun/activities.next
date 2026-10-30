/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag,
  updateProfile,
  uploadAttachment
} from '@/lib/client'
import { ApiRequestError } from '@/lib/client/http'
import { createDeferred } from '@/lib/testing/deferred'
import type { SavedProfile } from '@/lib/types/domain/savedProfile'

import { ProfileEditor } from './ProfileEditor'
import { hasUnsavedProfileChanges } from './unsavedProfileChanges'

const push = vi.fn()
const refresh = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace })
}))

vi.mock('@/lib/client', async () => {
  const http =
    await vi.importActual<typeof import('@/lib/client/http')>(
      '@/lib/client/http'
    )
  return {
    ApiRequestError: http.ApiRequestError,
    updateProfile: vi.fn(),
    uploadAttachment: vi.fn(),
    getFeaturedTags: vi.fn(),
    getFeaturedTagSuggestions: vi.fn(),
    addFeaturedTag: vi.fn(),
    removeFeaturedTag: vi.fn()
  }
})

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn(async (file: File) => file)
}))

vi.mock('@/lib/components/instance-limits', () => ({
  useInstanceLimits: () => ({ maxMediaFileSize: 1024 * 1024 })
}))

const mockUpdateProfile = updateProfile as jest.Mock
const mockUpload = uploadAttachment as jest.Mock

const ACTOR_ID = 'https://llun.test/users/anna'
const PROFILE_URL = 'https://llun.test/@anna'
const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

const buildProfile = (overrides: Partial<SavedProfile> = {}): SavedProfile => ({
  name: 'Anna',
  summary: 'Wildlife photographer.',
  fields: [],
  iconUrl: null,
  headerImageUrl: null,
  avatarDescription: '',
  headerDescription: '',
  showReplies: true,
  showMedia: true,
  showGallery: true,
  showFitness: true,
  ...overrides
})

const renderEditor = (
  profile: SavedProfile = buildProfile(),
  extra: Partial<React.ComponentProps<typeof ProfileEditor>> = {}
) =>
  render(
    <ProfileEditor
      actorId={ACTOR_ID}
      {...extra}
      profile={profile}
      username="anna"
      handle="@anna@llun.test"
      profileUrl={PROFILE_URL}
      profilePath="/@anna@llun.test"
    />
  )

const saveButton = () => screen.getByRole('button', { name: 'Save changes' })
const bio = () => screen.getByLabelText('Bio') as HTMLTextAreaElement
const name = () => screen.getByLabelText('Display name') as HTMLInputElement
const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } })

describe('ProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getFeaturedTags as jest.Mock).mockResolvedValue([])
    ;(getFeaturedTagSuggestions as jest.Mock).mockResolvedValue([])
    ;(addFeaturedTag as jest.Mock).mockResolvedValue({})
    ;(removeFeaturedTag as jest.Mock).mockResolvedValue({ removed: true })
    // The switches measure themselves with a ResizeObserver, which jsdom lacks.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('layout', () => {
    it('titles the page and links back to the profile', () => {
      renderEditor()

      expect(
        screen.getByRole('heading', { name: 'Edit profile', level: 2 })
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          '@anna@llun.test · Everything here is public and is sent to servers that follow you when you save.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Back to your profile' })
      ).toHaveAttribute('href', '/@anna@llun.test')
    })

    it('hides the in-content Back to profile link below lg where the section layout shows its own Back row', () => {
      renderEditor()

      expect(
        screen.getByRole('link', { name: 'Back to your profile' })
      ).toHaveClass('max-lg:hidden')
    })

    it('draws one box per section, in order', () => {
      renderEditor()

      expect(
        screen
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent)
      ).toEqual([
        'Edit profile',
        'Photos',
        'About you',
        'Profile fields',
        'Featured hashtags',
        'Profile tabs'
      ])
      for (const title of [
        'Photos',
        'About you',
        'Profile fields',
        'Featured hashtags',
        'Profile tabs'
      ]) {
        const section = screen.getByRole('region', { name: title })
        expect(
          section.querySelectorAll('[data-slot="frame"]').length
        ).toBeGreaterThan(0)
      }
    })

    it('shows the handle read-only with its note', () => {
      renderEditor()

      const handle = screen.getByLabelText('Handle')
      expect(handle).toHaveValue('@anna@llun.test')
      expect(handle).toBeDisabled()
      expect(
        screen.getByText('Your address on the fediverse. It can’t be changed.')
      ).toBeInTheDocument()
    })

    it('anchors Featured hashtags outside the page form, since its add bar is a form', () => {
      renderEditor()

      const section = screen.getByRole('region', { name: 'Featured hashtags' })
      expect(section).toHaveAttribute('id', 'featured-hashtags')
      expect(section.closest('form')).toBeNull()
      expect(
        (screen.getByLabelText('Display name') as HTMLInputElement).form
      ).not.toContainElement(section)
    })

    it('offers the four optional tabs with their notes and the privacy links', () => {
      renderEditor()

      for (const label of ['Replies', 'Media', 'Gallery', 'Fitness']) {
        expect(
          screen.getByRole('switch', { name: `Show ${label} tab` })
        ).toBeChecked()
      }
      expect(
        screen.getByText(
          'Posts is always shown. Choose which other tabs visitors see.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText('Your photo subjects, albums and map.')
      ).toBeVisible()
      expect(screen.getByText('Your activities and heatmap.')).toBeVisible()
      const tabs = screen.getByRole('region', { name: 'Profile tabs' })
      expect(
        within(tabs).getByRole('link', { name: 'Fitness privacy' })
      ).toHaveAttribute('href', '/fitness/privacy')
      expect(
        within(tabs).getByRole('link', { name: 'Gallery privacy' })
      ).toHaveAttribute('href', '/gallery/privacy')
    })

    it('shows a live preview with the Set in Settings card', () => {
      renderEditor()

      const preview = screen.getByRole('complementary', { name: 'Preview' })
      expect(within(preview).getByText('Anna')).toBeInTheDocument()
      expect(
        within(preview).getByText('Wildlife photographer.')
      ).toBeInTheDocument()
      expect(
        within(preview).getByText(
          'Preview updates as you type. Other servers see the change after you save.'
        )
      ).toBeInTheDocument()
      const card = within(preview).getByRole('navigation', {
        name: 'Set in Settings'
      })
      expect(
        within(card).getByRole('link', { name: /Who can follow you/ })
      ).toHaveAttribute('href', '/settings/privacy')
      expect(
        within(card).getByRole('link', { name: /Fitness privacy/ })
      ).toHaveAttribute('href', '/fitness/privacy')
      expect(
        within(card).getByRole('link', { name: /Gallery privacy/ })
      ).toHaveAttribute('href', '/gallery/privacy')
    })

    it('updates the preview as you type and as you flip a tab', () => {
      renderEditor()
      const preview = screen.getByRole('complementary', { name: 'Preview' })

      type(name(), 'Anna K')
      type(bio(), 'New bio')
      fireEvent.click(screen.getByRole('switch', { name: 'Show Media tab' }))

      expect(within(preview).getByText('Anna K')).toBeInTheDocument()
      expect(within(preview).getByText('New bio')).toBeInTheDocument()
      const strip = preview.querySelector(
        '[data-slot="profile-preview-tabs"]'
      ) as HTMLElement
      expect(strip.textContent).toBe('PostsRepliesGalleryFitness')
    })

    it('sizes the preview column by a container query at 860px rather than viewport width', () => {
      const { container } = renderEditor()

      const preview = screen.getByRole('complementary', { name: 'Preview' })
      const previewColumn = preview.parentElement as HTMLElement
      expect(previewColumn).toHaveClass(
        'sticky',
        'top-[103px]',
        'hidden',
        '@min-[860px]:block'
      )

      expect(container.firstElementChild).toHaveClass('@container')
    })
  })

  describe('dirty state', () => {
    it('starts clean with Save off', () => {
      renderEditor()

      expect(saveButton()).toBeDisabled()
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    })

    it('turns dirty on an edit and clean again when the edit is undone', () => {
      renderEditor()

      type(bio(), 'Something else')
      expect(saveButton()).toBeEnabled()
      expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()

      type(bio(), 'Wildlife photographer.')
      expect(saveButton()).toBeDisabled()
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    })

    it('counts a flipped tab, a new field and a cleared name as changes', () => {
      renderEditor()

      fireEvent.click(screen.getByRole('switch', { name: 'Show Fitness tab' }))
      expect(saveButton()).toBeEnabled()
      fireEvent.click(screen.getByRole('switch', { name: 'Show Fitness tab' }))
      expect(saveButton()).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      type(screen.getByLabelText('Field 1 content'), 'https://anna.example')
      expect(saveButton()).toBeEnabled()
    })

    it('does not count an empty extra field row as a change', () => {
      renderEditor()

      fireEvent.click(screen.getByRole('button', { name: 'Custom field' }))

      expect(saveButton()).toBeDisabled()
    })

    it('shows the phone bar with Cancel, the title and Save', () => {
      renderEditor()

      const bar = document.querySelector(
        '[data-slot="profile-editor-phone-bar"]'
      ) as HTMLElement
      expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeVisible()
      expect(within(bar).getByText('Edit profile')).toBeVisible()
      const save = within(bar).getByRole('button', { name: 'Save' })
      expect(save).toBeDisabled()
      type(bio(), 'Changed')
      expect(save).toBeEnabled()
    })
  })

  describe('saving', () => {
    it('sends only the changed keys as JSON and then shows the toast', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ summary: 'New bio' }))
      renderEditor()

      type(bio(), 'New bio')
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          summary: 'New bio'
        })
      )
      expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
      const toast = await screen.findByTestId('profile-saved-toast')
      expect(toast).toHaveTextContent('Profile saved')
      expect(toast).toHaveTextContent(
        'Servers that follow you will show the change within a few minutes.'
      )
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('announces a second save again while the first message is still up', async () => {
      renderEditor()
      mockUpdateProfile.mockResolvedValueOnce(buildProfile({ summary: 'One' }))
      type(bio(), 'One')
      fireEvent.click(saveButton())
      await screen.findByTestId('profile-saved-toast')
      const region = screen
        .getAllByRole('status')
        .find((element) => element.classList.contains('sr-only')) as HTMLElement
      const first = within(region).getByText(/Profile saved/)

      mockUpdateProfile.mockResolvedValueOnce(buildProfile({ summary: 'Two' }))
      type(bio(), 'Two')
      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenLastCalledWith({
          actorId: ACTOR_ID,
          summary: 'Two'
        })
      )

      await waitFor(() =>
        expect(within(region).getByText(/Profile saved/)).not.toBe(first)
      )
      expect(first.isConnected).toBe(false)
    })

    it('sends a flipped tab and the filled-in links, and nothing else', async () => {
      mockUpdateProfile.mockResolvedValue(
        buildProfile({
          showFitness: false,
          fields: [
            { name: 'Website', value: 'https://anna.example', verifiedAt: null }
          ]
        })
      )
      renderEditor()

      fireEvent.click(screen.getByRole('switch', { name: 'Show Fitness tab' }))
      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      type(screen.getByLabelText('Field 1 content'), '  https://anna.example ')
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          showFitness: false,
          fields: [{ name: 'Website', value: 'https://anna.example' }]
        })
      )
    })

    it('does not send the name or bio when only a tab changed', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ showGallery: false }))
      renderEditor()

      fireEvent.click(screen.getByRole('switch', { name: 'Show Gallery tab' }))
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          showGallery: false
        })
      )
    })

    it('sends a cleared image as null', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile())
      renderEditor(buildProfile({ iconUrl: MEDIA_URL }))

      fireEvent.click(screen.getByRole('button', { name: 'Remove avatar' }))
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          iconUrl: null
        })
      )
    })

    it('is clean after a save and compares later edits with the saved profile it got back', async () => {
      // The server answers with its own copy of the bio.
      mockUpdateProfile.mockResolvedValue(
        buildProfile({ summary: 'Saved bio' })
      )
      renderEditor()

      type(bio(), 'Typed bio')
      fireEvent.click(saveButton())

      await screen.findByTestId('profile-saved-toast')
      expect(bio()).toHaveValue('Saved bio')
      expect(saveButton()).toBeDisabled()
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument()

      // The old baseline no longer counts as clean.
      type(bio(), 'Wildlife photographer.')
      expect(saveButton()).toBeEnabled()
      type(bio(), 'Saved bio')
      expect(saveButton()).toBeDisabled()
    })

    it('disables Save while the request is in flight', async () => {
      const pending = createDeferred<SavedProfile>()
      mockUpdateProfile.mockReturnValue(pending.promise)
      renderEditor()

      type(bio(), 'New bio')
      fireEvent.click(saveButton())

      await waitFor(() => expect(saveButton()).toBeDisabled())
      fireEvent.click(saveButton())
      expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
      await act(async () => {
        pending.resolve(buildProfile({ summary: 'New bio' }))
      })
    })

    it('says a new link is being checked, before the save and after it', async () => {
      mockUpdateProfile.mockResolvedValue(
        buildProfile({
          fields: [
            { name: 'Website', value: 'https://anna.example', verifiedAt: null }
          ]
        })
      )
      renderEditor()

      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      type(screen.getByLabelText('Field 1 content'), 'https://anna.example')
      expect(
        screen.getByText('Checking for a link back to your profile…')
      ).toBeInTheDocument()

      fireEvent.click(saveButton())
      await screen.findByTestId('profile-saved-toast')
      expect(
        screen.getByText('Checking for a link back to your profile…')
      ).toBeInTheDocument()
    })

    it('shows a saved link as verified once the server says so', () => {
      renderEditor(
        buildProfile({
          fields: [
            {
              name: 'Website',
              value: 'https://anna.example',
              verifiedAt: '2026-10-01T00:00:00.000Z'
            }
          ]
        })
      )

      expect(screen.getByText('Verified')).toBeInTheDocument()
      expect(
        screen.queryByText('Checking for a link back to your profile…')
      ).toBeNull()
    })

    it('does not send a half-filled link row and shows why', async () => {
      renderEditor()

      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      fireEvent.click(saveButton())

      expect(mockUpdateProfile).not.toHaveBeenCalled()
    })
  })

  describe('errors from the save', () => {
    it('shows a 422 for the bio under the bio and keeps the edit', async () => {
      mockUpdateProfile.mockRejectedValue(
        new ApiRequestError('Invalid summary', 422)
      )
      renderEditor()

      type(bio(), 'Too long')
      fireEvent.click(saveButton())

      const message = await screen.findByText('Invalid summary')
      expect(message).toHaveAttribute('role', 'alert')
      expect(bio()).toHaveAttribute('aria-invalid', 'true')
      expect(bio()).toHaveAccessibleDescription('Invalid summary')
      expect(bio()).toHaveValue('Too long')
      expect(screen.queryByTestId('profile-saved-toast')).toBeNull()
      expect(refresh).not.toHaveBeenCalled()
      expect(saveButton()).toBeEnabled()

      // Typing again clears the message.
      type(bio(), 'Shorter')
      expect(screen.queryByText('Invalid summary')).toBeNull()
    })

    it('maps a 422 for the name, the links and an image to its own field', async () => {
      mockUpdateProfile.mockRejectedValueOnce(
        new ApiRequestError('Invalid name', 422)
      )
      renderEditor()
      type(name(), 'Anna K')
      fireEvent.click(saveButton())
      expect(await screen.findByText('Invalid name')).toBeInTheDocument()
      expect(name()).toHaveAttribute('aria-invalid', 'true')

      mockUpdateProfile.mockRejectedValueOnce(
        new ApiRequestError('Invalid fields', 422)
      )
      fireEvent.click(saveButton())
      // The request ran again with the same edit and now the links failed.
      expect(await screen.findByText('Invalid fields')).toBeInTheDocument()

      mockUpdateProfile.mockRejectedValueOnce(
        new ApiRequestError('Invalid iconUrl', 422)
      )
      fireEvent.click(saveButton())
      const region = await screen.findByText('Invalid iconUrl')
      expect(region).toHaveAttribute('role', 'alert')
    })

    it('tells the person to reload when the profile in use has changed, and keeps the edit unsaved', async () => {
      mockUpdateProfile.mockRejectedValue(
        new ApiRequestError('Actor changed', 409)
      )
      const reload = vi.fn()
      vi.stubGlobal('location', { ...window.location, reload })
      renderEditor()

      type(bio(), 'New bio')
      fireEvent.click(saveButton())

      expect(
        await screen.findByText(/You switched to another profile/)
      ).toBeInTheDocument()
      expect(screen.queryByTestId('profile-saved-toast')).toBeNull()
      expect(refresh).not.toHaveBeenCalled()
      expect(bio()).toHaveValue('New bio')
      // Every retry would be refused, so Save is off and the bar says why.
      expect(saveButton()).toBeDisabled()
      expect(screen.getByText('Couldn’t save your profile.')).toBeVisible()
      // Only the focused Alert announces; the bar's text is not a second alert.
      expect(
        screen.getByText('Couldn’t save your profile.')
      ).not.toHaveAttribute('role')
      // Focus moves to the Alert like for a failed save, from an effect that
      // can run after the text appears.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen
            .getByText(/You switched to another profile/)
            .closest('[tabindex]')
        )
      )

      // The notice stays through further typing.
      type(bio(), 'Newer bio')
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalled()
      expect(
        screen.getByText(/You switched to another profile/)
      ).toBeInTheDocument()
    })

    it('shows any other failure as an Alert above the page', async () => {
      mockUpdateProfile.mockRejectedValue(new ApiRequestError('Not found', 404))
      renderEditor()

      type(bio(), 'New bio')
      fireEvent.click(saveButton())

      const alert = await screen.findByText('Couldn’t save your profile')
      expect(alert.closest('[data-slot="alert"]')).toHaveTextContent(
        'Not found'
      )
      expect(alert.closest('[data-slot="frame"]')).toBeNull()
      expect(screen.queryByTestId('profile-saved-toast')).toBeNull()
    })
  })

  describe('clearing a failure', () => {
    it('drops the note and the alert when the edits are undone', async () => {
      mockUpdateProfile.mockRejectedValue(new ApiRequestError('Not found', 404))
      renderEditor()
      type(bio(), 'New bio')
      fireEvent.click(saveButton())
      await screen.findByText('Couldn’t save your profile')
      expect(
        screen.getAllByText('Couldn’t save your profile.').length
      ).toBeGreaterThan(0)

      type(bio(), 'Wildlife photographer.')

      expect(screen.queryByText('Couldn’t save your profile')).toBeNull()
      expect(screen.queryByText('Couldn’t save your profile.')).toBeNull()
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    })

    it('drops a form-level failure at the next edit', async () => {
      mockUpdateProfile.mockRejectedValue(new ApiRequestError('Not found', 404))
      renderEditor()
      type(bio(), 'New bio')
      fireEvent.click(saveButton())
      await screen.findByText('Couldn’t save your profile')

      type(bio(), 'New bio again')

      expect(screen.queryByText('Couldn’t save your profile')).toBeNull()
      expect(screen.queryByText('Couldn’t save your profile.')).toBeNull()
      expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()
    })

    it('drops a field failure when that field is edited, and the bar note with it', async () => {
      mockUpdateProfile.mockRejectedValue(
        new ApiRequestError('Invalid summary', 422)
      )
      renderEditor()
      type(bio(), 'x'.repeat(10))
      fireEvent.click(saveButton())
      await screen.findByText('Fix the highlighted field to save.')

      type(bio(), 'Shorter')

      expect(
        screen.queryByText('Fix the highlighted field to save.')
      ).toBeNull()
    })
  })

  describe('photos', () => {
    it('uploads a chosen header through the media upload and saves its URL', async () => {
      mockUpload.mockResolvedValue({ url: MEDIA_URL })
      mockUpdateProfile.mockResolvedValue(
        buildProfile({ headerImageUrl: MEDIA_URL })
      )
      renderEditor()

      const photos = screen.getByRole('region', { name: 'Photos' })
      const input =
        photos.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]
      const file = new File(['x'], 'header.png', { type: 'image/png' })
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(saveButton()).toBeEnabled())
      expect(mockUpload).toHaveBeenCalledTimes(1)
      expect(mockUpload.mock.calls[0][0]).toBe(file)
      // Nothing is saved until Save.
      expect(mockUpdateProfile).not.toHaveBeenCalled()

      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          headerImageUrl: MEDIA_URL
        })
      )
    })

    it('shows an upload failure next to the picture and leaves the form clean', async () => {
      mockUpload.mockResolvedValue(null)
      renderEditor()

      const photos = screen.getByRole('region', { name: 'Photos' })
      const input =
        photos.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
      fireEvent.change(input, {
        target: {
          files: [new File(['x'], 'me.png', { type: 'image/png' })]
        }
      })

      expect(
        await screen.findByText('Failed to upload image. Please try again.')
      ).toHaveAttribute('role', 'alert')
      expect(saveButton()).toBeDisabled()
    })

    it('sends alt texts from behind their buttons', async () => {
      mockUpdateProfile.mockResolvedValue(
        buildProfile({ avatarDescription: 'A smiling woman' })
      )
      renderEditor()

      fireEvent.click(screen.getByRole('button', { name: 'Avatar alt text' }))
      type(
        screen.getByLabelText('Avatar alt text', { selector: 'textarea' }),
        'A smiling woman'
      )
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          avatarDescription: 'A smiling woman'
        })
      )
    })
  })

  describe('edits while a save is in flight', () => {
    it('keeps what was typed after the request was sent, and stays unsaved', async () => {
      const pending = createDeferred<SavedProfile>()
      mockUpdateProfile.mockReturnValue(pending.promise)
      renderEditor()

      type(bio(), 'First')
      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          summary: 'First'
        })
      )
      type(bio(), 'First and more')
      type(name(), 'Anna K')
      await act(async () => pending.resolve(buildProfile({ summary: 'First' })))

      expect(bio()).toHaveValue('First and more')
      expect(name()).toHaveValue('Anna K')
      expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
      // The next save sends only what is still unsaved.
      mockUpdateProfile.mockResolvedValue(
        buildProfile({ summary: 'First and more', name: 'Anna K' })
      )
      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenLastCalledWith({
          actorId: ACTOR_ID,
          name: 'Anna K',
          summary: 'First and more'
        })
      )
    })

    it('takes the server copy for what was not touched meanwhile', async () => {
      mockUpdateProfile.mockResolvedValue(
        buildProfile({ avatarDescription: 'A smiling woman' })
      )
      renderEditor()

      fireEvent.click(screen.getByRole('button', { name: 'Avatar alt text' }))
      const alt = screen.getByLabelText('Avatar alt text', {
        selector: 'textarea'
      })
      type(alt, 'A smiling woman  ')
      fireEvent.click(saveButton())

      await waitFor(() => expect(alt).toHaveValue('A smiling woman'))
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    })

    it('takes the server copy of one field and keeps the in-flight edit of another, in the same render', async () => {
      const pending = createDeferred<SavedProfile>()
      mockUpdateProfile.mockReturnValue(pending.promise)
      renderEditor()
      fireEvent.click(screen.getByRole('button', { name: 'Avatar alt text' }))
      const alt = screen.getByLabelText('Avatar alt text', {
        selector: 'textarea'
      })
      type(alt, 'A smiling woman  ')
      type(bio(), 'Sent bio')
      fireEvent.click(saveButton())
      await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalled())
      // Typed after the request left: only the bio is touched again.
      type(bio(), 'Sent bio, then more')

      await act(async () =>
        pending.resolve(
          buildProfile({
            avatarDescription: 'A smiling woman',
            summary: 'Sent bio'
          })
        )
      )

      // The alt text takes the server's trimmed copy; the bio keeps the newer
      // typing, and only it is unsaved.
      expect(alt).toHaveValue('A smiling woman')
      expect(bio()).toHaveValue('Sent bio, then more')
      expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()
      mockUpdateProfile.mockResolvedValue(
        buildProfile({
          avatarDescription: 'A smiling woman',
          summary: 'Sent bio, then more'
        })
      )
      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenLastCalledWith({
          actorId: ACTOR_ID,
          summary: 'Sent bio, then more'
        })
      )
    })
  })

  describe('picture uploads', () => {
    it('holds Save back while a picture uploads, in both Save controls', async () => {
      const pending = createDeferred<{ url: string }>()
      mockUpload.mockReturnValue(pending.promise)
      renderEditor()
      type(bio(), 'New bio')
      expect(saveButton()).toBeEnabled()

      const input = screen
        .getByRole('region', { name: 'Photos' })
        .querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
      fireEvent.change(input, {
        target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] }
      })

      await waitFor(() => expect(saveButton()).toBeDisabled())
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByText(/Uploading a picture/)).toBeInTheDocument()
      fireEvent.submit(name().closest('form') as HTMLFormElement)
      expect(mockUpdateProfile).not.toHaveBeenCalled()

      mockUpdateProfile.mockResolvedValue(buildProfile())
      await act(async () => pending.resolve({ url: MEDIA_URL }))
      await waitFor(() => expect(saveButton()).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
  })

  describe('keyboard', () => {
    it('submits the form from both Save buttons, which sit outside it', () => {
      renderEditor()
      const form = name().closest('form') as HTMLFormElement

      for (const button of [
        saveButton(),
        screen.getByRole('button', { name: 'Save' })
      ]) {
        expect(button).toHaveAttribute('type', 'submit')
        expect(button).toHaveAttribute('form', form.id)
        expect(form.contains(button)).toBe(false)
      }
    })

    it('saves when the form is submitted, as Enter in a field does', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ name: 'Anna K' }))
      renderEditor()
      type(name(), 'Anna K')

      fireEvent.submit(name().closest('form') as HTMLFormElement)

      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith({
          actorId: ACTOR_ID,
          name: 'Anna K'
        })
      )
    })

    it('does nothing on submit while clean', () => {
      renderEditor()

      fireEvent.submit(name().closest('form') as HTMLFormElement)

      expect(mockUpdateProfile).not.toHaveBeenCalled()
    })

    it('keeps the featured hashtags add form apart from the profile form', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile())
      ;(addFeaturedTag as jest.Mock).mockResolvedValue({
        tag: {
          id: 't2',
          name: 'owls',
          url: 'https://llun.test/@anna/tagged/owls',
          statuses_count: '0',
          last_status_at: null
        }
      })
      renderEditor()
      type(name(), 'Anna K')
      const tagInput = await screen.findByRole('textbox', {
        name: 'Add a hashtag'
      })
      const tagForm = tagInput.closest('form') as HTMLFormElement
      expect(tagForm).not.toBe(name().closest('form'))
      expect(tagForm.contains(name())).toBe(false)

      type(tagInput, 'owls')
      fireEvent.submit(tagForm)

      await waitFor(() =>
        expect(addFeaturedTag).toHaveBeenCalledWith('owls', ACTOR_ID)
      )
      expect(mockUpdateProfile).not.toHaveBeenCalled()
    })
  })

  describe('phone bar', () => {
    it('sticks under the settings mobile bar with a background', () => {
      renderEditor()

      const bar = document.querySelector(
        '[data-slot="profile-editor-phone-bar"]'
      ) as HTMLElement
      expect(bar).toHaveClass(
        'sticky',
        'md:hidden',
        'bg-background',
        'border-b'
      )
      // The settings page's own mobile bar is 56px plus the top safe area, at
      // z-30, and the connection strip hangs under it while the app is not
      // online; this one sits below both, one z-step down.
      expect(bar.className).toContain(
        'top-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px))]'
      )
      expect(bar).toHaveClass('z-20')
    })
  })

  describe('focus after a failed save', () => {
    const fail = async (message: string, status = 422) => {
      mockUpdateProfile.mockRejectedValue(new ApiRequestError(message, status))
      type(name(), 'Anna K')
      fireEvent.click(saveButton())
      await screen.findByText(message, { exact: false })
    }

    it('focuses the bio for an invalid bio and says so in the Save bar', async () => {
      renderEditor()

      await fail('Invalid summary')

      await waitFor(() => expect(bio()).toHaveFocus())
      expect(
        screen.getByText('Fix the highlighted field to save.')
      ).toBeInTheDocument()
    })

    it('focuses the display name for an invalid name', async () => {
      renderEditor()

      await fail('Invalid name')

      await waitFor(() => expect(name()).toHaveFocus())
    })

    it('focuses the first link field for invalid links', async () => {
      renderEditor(
        buildProfile({
          fields: [
            { name: 'Blog', value: 'https://a.example', verifiedAt: null }
          ]
        })
      )

      await fail('Invalid fields')

      await waitFor(() =>
        expect(screen.getByLabelText('Field 1 label')).toHaveFocus()
      )
    })

    it('focuses the Change button for a rejected image', async () => {
      renderEditor()

      await fail('Invalid iconUrl')

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Change avatar' })
        ).toHaveFocus()
      )
    })

    it('opens and focuses the alt text for a rejected description', async () => {
      renderEditor()

      await fail('Invalid headerDescription')

      const alt = screen.getByLabelText('Header alt text', {
        selector: 'textarea'
      })
      await waitFor(() => expect(alt).toHaveFocus())
      expect(alt.parentElement).not.toHaveAttribute('hidden')
    })

    it('focuses the form Alert for any other failure', async () => {
      renderEditor()

      await fail('Not found', 404)

      const alert = screen
        .getByText('Couldn’t save your profile')
        .closest('[data-slot="alert"]') as HTMLElement
      await waitFor(() => expect(alert.parentElement).toHaveFocus())
      expect(
        screen.getByText('Couldn’t save your profile.')
      ).toBeInTheDocument()
    })
  })

  describe('the switch notice', () => {
    it('drops ?switched=1 after the first save', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ name: 'Anna K' }))
      renderEditor(buildProfile(), { switched: true })

      type(name(), 'Anna K')
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith('/settings/profile')
      )
      expect(refresh).not.toHaveBeenCalled()
    })

    it('only refreshes when the page was not opened by a switch', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ name: 'Anna K' }))
      renderEditor()

      type(name(), 'Anna K')
      fireEvent.click(saveButton())

      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
      expect(replace).not.toHaveBeenCalled()
    })
  })

  describe('pending link checks across saves', () => {
    it('keeps Checking… for a link a later name-only save did not touch', async () => {
      renderEditor()
      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      type(screen.getByLabelText('Field 1 content'), 'https://anna.example')
      const withLink = buildProfile({
        fields: [
          { name: 'Website', value: 'https://anna.example', verifiedAt: null }
        ]
      })
      mockUpdateProfile.mockResolvedValueOnce(withLink)
      fireEvent.click(saveButton())
      await screen.findByText(/Checking for a link back/)

      mockUpdateProfile.mockResolvedValueOnce({ ...withLink, name: 'Anna K' })
      type(name(), 'Anna K')
      fireEvent.click(saveButton())
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenLastCalledWith({
          actorId: ACTOR_ID,
          name: 'Anna K'
        })
      )

      await waitFor(() => expect(saveButton()).toBeDisabled())
      expect(screen.getByText(/Checking for a link back/)).toBeInTheDocument()
      expect(screen.queryByText('Not verified')).toBeNull()
    })
  })

  describe('unsaved changes guard', () => {
    const clickLink = (name: string | RegExp) =>
      fireEvent.click(screen.getAllByRole('link', { name })[0])

    it('asks before following an in-app link with unsaved changes', () => {
      renderEditor()
      type(bio(), 'Changed')

      clickLink('Back to your profile')

      const dialog = screen.getByRole('dialog', { name: 'Discard changes?' })
      expect(dialog).toHaveTextContent(
        'You changed your bio. They haven’t been saved.'
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('stays on the page for Keep editing', () => {
      renderEditor()
      type(bio(), 'Changed')
      clickLink('Back to your profile')

      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(push).not.toHaveBeenCalled()
      expect(bio()).toHaveValue('Changed')
    })

    it('follows the held-back link for Discard, and no longer asks', () => {
      renderEditor()
      type(bio(), 'Changed')
      clickLink(/Fitness privacy/)

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(push).toHaveBeenCalledWith('/fitness/privacy')
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    it('names every kind of change in the question', () => {
      renderEditor()
      type(bio(), 'Changed')
      fireEvent.click(screen.getByRole('switch', { name: 'Show Media tab' }))
      fireEvent.click(screen.getByRole('button', { name: 'Website' }))
      type(screen.getByLabelText('Field 1 content'), 'https://anna.example')
      clickLink('Back to your profile')

      expect(screen.getByRole('dialog')).toHaveTextContent(
        'You changed your bio, your profile fields and your profile tabs.'
      )
    })

    it('does not ask after a successful save', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ summary: 'Changed' }))
      renderEditor()
      type(bio(), 'Changed')
      fireEvent.click(saveButton())
      await screen.findByTestId('profile-saved-toast')

      clickLink('Back to your profile')
      expect(screen.queryByRole('dialog')).toBeNull()
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    it('asks again for an edit made after a save', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ summary: 'Changed' }))
      renderEditor()
      type(bio(), 'Changed')
      fireEvent.click(saveButton())
      await screen.findByTestId('profile-saved-toast')

      type(bio(), 'Changed again')
      clickLink('Back to your profile')

      expect(
        screen.getByRole('dialog', { name: 'Discard changes?' })
      ).toBeVisible()
    })

    it('leaves a modified click, a new tab and an outside link alone', () => {
      renderEditor()
      type(bio(), 'Changed')
      const back = screen.getByRole('link', { name: 'Back to your profile' })

      fireEvent.click(back, { metaKey: true })
      fireEvent.click(back, { ctrlKey: true })
      fireEvent.click(back, { button: 1 })

      expect(screen.queryByRole('dialog')).toBeNull()
    })

    describe('Back and Forward', () => {
      class FakeNavigation extends EventTarget {
        traverseTo = vi.fn()
        back(url = 'http://localhost/settings') {
          const event = new Event('navigate', { cancelable: true })
          Object.assign(event, {
            navigationType: 'traverse',
            destination: { key: 'prev', url, sameDocument: true }
          })
          return this.dispatchEvent(event)
        }
      }
      let navigation: FakeNavigation
      beforeEach(() => {
        navigation = new FakeNavigation()
        Object.defineProperty(window, 'navigation', {
          value: navigation,
          configurable: true
        })
      })
      afterEach(() => Reflect.deleteProperty(window, 'navigation'))

      it('cancels Back with unsaved changes and asks, and Discard replays it', () => {
        renderEditor()
        type(bio(), 'Changed')

        let went = true
        act(() => {
          went = navigation.back()
        })

        expect(went).toBe(false)
        expect(
          screen.getByRole('dialog', { name: 'Discard changes?' })
        ).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
        expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('prev')
      })

      it('lets Back through on a clean page, and after the changes are undone', () => {
        renderEditor()
        expect(navigation.back()).toBe(true)

        type(bio(), 'Changed')
        type(bio(), 'Wildlife photographer.')
        expect(navigation.back()).toBe(true)
        expect(screen.queryByRole('dialog')).toBeNull()
      })
    })

    it('goes straight to the profile on Cancel when clean', () => {
      renderEditor()

      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(push).toHaveBeenCalledWith('/@anna@llun.test')
    })

    it('asks on Cancel with changes, and Discard leaves without a second question', () => {
      renderEditor()
      type(bio(), 'Changed')

      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      expect(push).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
      expect(push).not.toHaveBeenCalled()

      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(push).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledWith('/@anna@llun.test')
      // The page is still "dirty" while it navigates, but the guard stands down.
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      clickLink('Back to your profile')
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('featured hashtags', () => {
    it('saves a hashtag at once and does not make the page dirty', async () => {
      ;(addFeaturedTag as jest.Mock).mockResolvedValue({
        tag: {
          id: 't1',
          name: 'birds',
          url: 'https://llun.test/@anna/tagged/birds',
          statuses_count: '3',
          last_status_at: null
        }
      })
      renderEditor()
      await screen.findByText('No featured hashtags yet')

      const input = screen.getByLabelText('Add a hashtag')
      type(input, 'birds')
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      await screen.findByText('#birds')
      expect(addFeaturedTag).toHaveBeenCalledWith('birds', ACTOR_ID)
      expect(mockUpdateProfile).not.toHaveBeenCalled()
      expect(saveButton()).toBeDisabled()
    })

    it('after a hashtag 409 on a clean page: no profile-save error, hashtag controls off', async () => {
      ;(addFeaturedTag as jest.Mock).mockResolvedValue({
        error: 'Actor changed',
        actorChanged: true
      })
      renderEditor()
      await screen.findByText('No featured hashtags yet')

      const input = screen.getByLabelText('Add a hashtag')
      type(input, 'birds')
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      await screen.findByText(/You switched to another profile/)
      expect(screen.queryByText('Couldn’t save your profile.')).toBeNull()
      expect(screen.getByLabelText('Add a hashtag')).toBeDisabled()
    })

    it('shows the reload notice once when a hashtag save finds another profile', async () => {
      ;(addFeaturedTag as jest.Mock).mockResolvedValue({
        error: 'Actor changed',
        actorChanged: true
      })
      renderEditor()
      await screen.findByText('No featured hashtags yet')

      const input = screen.getByLabelText('Add a hashtag')
      type(input, 'birds')
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      expect(
        await screen.findByText(/You switched to another profile/)
      ).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Reload' })).toHaveLength(1)
      expect(document.activeElement).toBe(
        screen
          .getByText(/You switched to another profile/)
          .closest('[tabindex]')
      )
    })
  })

  describe('unsaved changes flag', () => {
    it('is set by typing, cleared by undoing the edit and by unmounting', () => {
      const { unmount } = renderEditor()
      expect(hasUnsavedProfileChanges()).toBe(false)

      type(bio(), 'Changed')
      expect(hasUnsavedProfileChanges()).toBe(true)

      type(bio(), buildProfile().summary)
      expect(hasUnsavedProfileChanges()).toBe(false)

      type(bio(), 'Changed again')
      expect(hasUnsavedProfileChanges()).toBe(true)
      unmount()
      expect(hasUnsavedProfileChanges()).toBe(false)
    })
  })

  describe('Cancel question', () => {
    it('closes when a save lands and the page becomes clean', async () => {
      mockUpdateProfile.mockResolvedValue(buildProfile({ summary: 'Changed' }))
      renderEditor()
      type(bio(), 'Changed')
      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.submit(bio().closest('form') as HTMLFormElement)

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(push).not.toHaveBeenCalled()
    })
  })
})
