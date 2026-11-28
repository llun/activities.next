/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import type { ProfileTabContent } from '@/lib/types/domain/profileTabs'

import { ProfilePreview } from './ProfilePreview'
import { type ProfileDraft, toDraft } from './profileDraft'

// Radix draws the <img> only once the picture has loaded, which jsdom never
// does; draw it at once so its src and alt text can be read.
vi.mock('@/lib/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AvatarImage: (props: { src?: string; alt?: string }) =>
    props.src ? <img data-testid="avatar-image" {...props} /> : null,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

const DRAFT: ProfileDraft = toDraft({
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
  showFitness: true
})

const ALL_CONTENT: ProfileTabContent = {
  hasMedia: true,
  hasGallery: true,
  hasFitness: true
}
const NO_CONTENT: ProfileTabContent = {
  hasMedia: false,
  hasGallery: false,
  hasFitness: false
}

const renderPreview = (
  draft: Partial<ProfileDraft> = {},
  tabContent: ProfileTabContent = ALL_CONTENT
) =>
  render(
    <ProfilePreview
      draft={{ ...DRAFT, ...draft }}
      actorId="https://llun.test/users/anna"
      username="anna"
      handle="@anna@llun.test"
      tabContent={tabContent}
    />
  )

const preview = () =>
  screen.getByText('Live preview · updates as you type')
    .parentElement as HTMLElement
const tabLabels = () =>
  within(preview())
    .queryAllByRole('radio')
    .map((radio) => radio.textContent)

describe('ProfilePreview', () => {
  it('has the caption and the note about other servers', () => {
    renderPreview()

    expect(
      within(preview()).getByText('Live preview · updates as you type')
    ).toBeInTheDocument()
    expect(
      within(preview()).getByText('Other servers see changes after you save.')
    ).toBeInTheDocument()
  })

  it('is inert, a picture and not a second set of controls', () => {
    renderPreview()

    expect(
      document.querySelector('[data-slot="profile-preview"]')
    ).toHaveAttribute('inert')
  })

  it('shows the name, handle and bio from the draft', () => {
    renderPreview()

    expect(within(preview()).getByText('Anna')).toBeInTheDocument()
    expect(within(preview()).getByText('@anna@llun.test')).toBeInTheDocument()
    expect(
      within(preview()).getByText('Wildlife photographer.')
    ).toBeInTheDocument()
  })

  it('falls back to the username without a display name, as the profile does', () => {
    renderPreview({ name: '  ' })

    expect(within(preview()).getByText('anna')).toBeInTheDocument()
  })

  it('shows the initials while there is no avatar', () => {
    renderPreview()

    expect(within(preview()).getByText('A')).toBeInTheDocument()
  })

  it('draws the avatar image from the draft, with its description as alt text', () => {
    renderPreview({
      iconUrl: 'https://llun.test/api/v1/files/a.jpg',
      avatarDescription: ' A smiling woman '
    })

    const image = within(preview()).getByTestId('avatar-image')
    expect(image).toHaveAttribute('src', 'https://llun.test/api/v1/files/a.jpg')
    expect(image).toHaveAttribute('alt', 'A smiling woman')
  })

  it('draws the header image when the draft has one and nothing when it does not', () => {
    const { unmount } = renderPreview()
    expect(
      screen.queryByRole('button', {
        name: 'Open profile header image preview'
      })
    ).toBeNull()
    unmount()

    renderPreview({ headerImageUrl: 'https://llun.test/api/v1/files/h.jpg' })
    expect(
      screen.getByRole('button', {
        name: 'Open profile header image preview'
      })
    ).toBeInTheDocument()
  })

  it('shows filled links on one line with the extras behind +N more', () => {
    renderPreview({
      fields: [
        { name: 'Website', value: 'https://one.example' },
        { name: 'Photos', value: 'https://two.example' },
        { name: 'Strava', value: 'https://three.example' },
        { name: 'Blog', value: 'https://four.example' },
        { name: 'Half', value: '' }
      ]
    })

    expect(within(preview()).getByText('one.example')).toBeInTheDocument()
    expect(within(preview()).getByText('+2 more')).toBeInTheDocument()
    expect(within(preview()).queryByText('Half')).toBeNull()
  })

  it('draws no tab strip when Posts is the only tab', () => {
    renderPreview({ showReplies: false }, NO_CONTENT)

    expect(within(preview()).queryByRole('radiogroup')).toBeNull()
  })

  it('draws the tab strip from the switches and the tab content', () => {
    renderPreview()

    expect(tabLabels()).toEqual([
      'Posts',
      'Replies',
      'Media',
      'Gallery',
      'Fitness'
    ])
  })

  it('shows a tab only when its switch is on and it has content', () => {
    const { unmount } = renderPreview({ showMedia: true }, NO_CONTENT)
    expect(tabLabels()).not.toContain('Media')
    unmount()

    renderPreview({ showMedia: false }, ALL_CONTENT)
    expect(tabLabels()).not.toContain('Media')
  })

  it('shows Replies from its switch alone', () => {
    const { unmount } = renderPreview({ showReplies: true }, NO_CONTENT)
    expect(tabLabels()).toContain('Replies')
    unmount()

    renderPreview({ showReplies: false }, NO_CONTENT)
    expect(tabLabels()).not.toContain('Replies')
  })

  it('has no Set in Settings card', () => {
    renderPreview()

    expect(within(preview()).queryByText('Set in Settings')).toBeNull()
    expect(within(preview()).queryByText('Who can follow you')).toBeNull()
  })
})
