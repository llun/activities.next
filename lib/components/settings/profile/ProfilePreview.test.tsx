/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { ProfilePreview } from './ProfilePreview'
import { type ProfileDraft, toDraft } from './profileDraft'

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

const renderPreview = (draft: Partial<ProfileDraft> = {}) =>
  render(
    <ProfilePreview
      draft={{ ...DRAFT, ...draft }}
      username="anna"
      handle="@anna@llun.test"
    />
  )

const tabs = () =>
  (document.querySelector('[data-slot="profile-preview-tabs"]') as HTMLElement)
    .textContent

describe('ProfilePreview', () => {
  it('shows the name, handle and bio from the draft', () => {
    renderPreview()

    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.getByText('@anna@llun.test')).toBeInTheDocument()
    expect(screen.getByText('Wildlife photographer.')).toBeInTheDocument()
  })

  it('falls back to the username without a display name, as the profile does', () => {
    renderPreview({ name: '  ' })

    expect(screen.getByText('anna')).toBeInTheDocument()
  })

  it('leaves out an empty bio', () => {
    renderPreview({ summary: '' })

    expect(
      document.querySelector('[data-slot="profile-preview-bio"]')
    ).toBeNull()
  })

  it('draws the header and avatar images when the draft has them', () => {
    renderPreview({
      headerImageUrl: 'https://llun.test/api/v1/files/h.jpg',
      iconUrl: 'https://llun.test/api/v1/files/a.jpg'
    })

    expect(
      document.querySelector<HTMLElement>(
        '[data-slot="profile-preview-header"]'
      )?.style.backgroundImage
    ).toContain('https://llun.test/api/v1/files/h.jpg')
  })

  it('shows the initial while there is no avatar', () => {
    renderPreview()

    expect(screen.getByText('A')).toBeInTheDocument()
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

    expect(screen.getByText('one.example')).toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
    expect(screen.queryByText('Half')).toBeNull()
  })

  it('draws the tab strip from the toggles, with Posts always first', () => {
    renderPreview()
    expect(tabs()).toBe('PostsRepliesMediaGalleryFitness')

    renderPreview({ showReplies: false, showFitness: false })
    expect(screen.getAllByText('Posts').length).toBeGreaterThan(0)
    expect(
      [...document.querySelectorAll('[data-slot="profile-preview-tabs"]')].map(
        (strip) => strip.textContent
      )
    ).toContain('PostsMediaGallery')
  })

  it('is inert, a picture and not a second set of controls', () => {
    renderPreview()

    expect(
      document.querySelector('[data-slot="profile-preview"]')
    ).toHaveAttribute('inert')
  })

  it('has the caption and the Set in Settings links', () => {
    renderPreview()

    const aside = screen.getByRole('complementary', { name: 'Preview' })
    expect(
      within(aside).getByText(
        'Preview updates as you type. Other servers see the change after you save.'
      )
    ).toBeInTheDocument()
    const links = within(
      within(aside).getByRole('navigation', { name: 'Set in Settings' })
    ).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings/privacy',
      '/fitness/privacy',
      '/gallery/privacy'
    ])
  })
})
