/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { Actor } from '@/lib/types/activitypub'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getProfileData } from './getProfileData'
import Page from './page'

const mockDatabase = {
  getFeaturedTags: vi.fn().mockResolvedValue([]),
  getActorSettings: vi.fn().mockResolvedValue(undefined)
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.social',
    mediaStorage: null
  }),
  getBaseURL: () => 'https://llun.social'
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  usePathname: () => '/@bob@mastodon.social'
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: vi.fn()
}))

vi.mock('./getProfileData', () => ({
  getProfileData: vi.fn()
}))

const mockActorTimelines = vi.fn()
vi.mock('./ActorTimelines', () => ({
  ActorTimelines: (props: unknown) => {
    mockActorTimelines(props)
    return <div data-testid="actor-timelines" />
  }
}))

vi.mock('./ProfileHeaderImage', () => ({
  ProfileHeaderImage: () => <div data-testid="header-image" />
}))

vi.mock('./ProfileRelationshipActions', () => ({
  ProfileRelationshipActions: () => <div data-testid="relationship-actions" />
}))

vi.mock('@/lib/services/mastodon/getMastodonFeaturedTag', () => ({
  getMastodonFeaturedTag: vi.fn()
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockGetProfileData = vi.mocked(getProfileData)

describe('[actor] page header handle link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'viewer@llun.social' }
    } as never)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
  })

  it('renders handle as a link opening in a new tab for a remote user with string url', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://pouet.chapril.org/users/clairenony',
        type: 'Person',
        preferredUsername: 'clairenony',
        name: 'Claire Nony',
        summary: 'Hello world',
        url: 'https://pouet.chapril.org/@clairenony'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 5,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 10,
      followersCount: 20,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })
    render(element)

    const link = screen.getByRole('link', {
      name: '@clairenony@pouet.chapril.org'
    })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('title', 'Open profile page')
    expect(mockActorTimelines).toHaveBeenCalledWith(
      expect.objectContaining({ isInternalAccount: false })
    )
  })

  it('renders handle link for remote user with object url', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: { type: 'Link', href: 'https://mastodon.social/@bob' }
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 2,
      followersCount: 3,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@bob@mastodon.social' })
    expect(link).toHaveAttribute('href', 'https://mastodon.social/@bob')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('falls back to person.id when person.url is missing', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://remote.example/users/alice',
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        summary: ''
      } as unknown as Actor,
      statuses: [],
      statusesCount: 0,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 0,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@alice@remote.example' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@alice@remote.example' })
    expect(link).toHaveAttribute('href', 'https://remote.example/users/alice')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders handle as a link opening in a new tab for a local user', async () => {
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/localuser',
        type: 'Person',
        preferredUsername: 'localuser',
        name: 'Local User',
        summary: 'Local bio',
        url: 'https://llun.social/@localuser'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 12,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 3,
      followersCount: 4,
      isInternalAccount: true,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@localuser@llun.social' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@localuser@llun.social' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://llun.social/@localuser')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(mockActorTimelines).toHaveBeenCalledWith(
      expect.objectContaining({ isInternalAccount: true })
    )
  })

  it('qualifies the handle with the domain the profile was resolved under, not the actor id host', async () => {
    // A multi-domain instance (or a remote actor whose WebFinger domain is not
    // its actor id's host) is addressed as @user@<url domain>; building the
    // handle from `person.id` would print `social.example.org` here.
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://social.example.org/users/anna',
        type: 'Person',
        preferredUsername: 'anna',
        name: 'Anna Nowak',
        summary: '',
        url: 'https://social.example.org/@anna'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 0,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@anna@example.com' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@anna@example.com' })
    expect(link).toHaveTextContent('@anna@example.com')
    expect(screen.queryByText('@anna@social.example.org')).toBeNull()
  })

  it('lets a long handle ellipsize while the external-link icon stays visible', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 0,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({
        actor: '@bob@a-very-long-subdomain.example-federation-domain.social'
      })
    })
    render(element)

    // jsdom has no layout: pin the classes that do it. The link is as wide as
    // the card at most, the handle inside it shrinks and ellipsizes, and the
    // icon keeps its size, so a handle wider than the card cannot push the icon
    // out of view (a `truncate` on the paragraph cannot ellipsize an
    // inline-flex link).
    const link = screen.getByRole('link', {
      name: '@bob@a-very-long-subdomain.example-federation-domain.social'
    })
    expect(link).toHaveClass('inline-flex', 'max-w-full')
    const handle = screen.getByText(
      '@bob@a-very-long-subdomain.example-federation-domain.social'
    )
    expect(handle).toHaveClass('min-w-0', 'truncate')
    expect(link.querySelector('svg')).toHaveClass('shrink-0')
  })

  it('draws the profile card on the Card surface, without a shadow', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 2,
      followersCount: 3,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    const { container } = render(element)

    const card = container.querySelector('section')
    expect(card).toHaveClass('bg-card', 'border', 'rounded-2xl')
    expect(card?.className).not.toMatch(/shadow|bg-background/)
  })

  it('draws the 80px profile avatar initial at 34px, not the 30px its bordered box would give', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 2,
      followersCount: 3,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    const { container } = render(element)

    // The avatar is 80px wide but carries a 4px border, so the shared 42cqw
    // initial resolves against a 72px content box (30.24px). The Avatar board
    // draws the 80px monogram at 34, so the profile sets the size itself.
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toHaveClass('h-20', 'w-20', 'border-4')
    const initial = container.querySelector('[data-slot="avatar-fallback"]')
    expect(initial).toHaveTextContent('B')
    expect(initial).toHaveClass('text-[34px]')
    expect(initial).not.toHaveClass('text-[42cqw]')
  })

  it('renders software name and version under the counts block', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 10,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 5,
      followersCount: 15,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: {
        name: 'mastodon',
        version: '4.3.0'
      }
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    const softwareElement = screen.getByText('Mastodon/4.3.0')
    expect(softwareElement).toBeInTheDocument()
    const container = softwareElement.closest('div')
    expect(container).toHaveClass(
      'flex',
      'items-center',
      'gap-1.5',
      'text-sm',
      'text-muted-foreground',
      'break-words',
      'mt-3'
    )
    const icon = container?.querySelector('svg')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('lucide-info', 'size-3.5')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders software name without version when version is omitted', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 10,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 5,
      followersCount: 15,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: {
        name: 'mastodon',
        version: null
      }
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    const softwareElement = screen.getByText('Mastodon')
    expect(softwareElement).toBeInTheDocument()
    const container = softwareElement.closest('div')
    expect(container).toHaveClass(
      'flex',
      'items-center',
      'gap-1.5',
      'text-sm',
      'text-muted-foreground',
      'break-words'
    )
    const icon = container?.querySelector('svg')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('lucide-info', 'size-3.5')
  })

  it('applies mt-5 when all counts are null and software is present', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: null,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: null,
      followersCount: null,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: {
        name: 'mastodon',
        version: '4.3.0'
      }
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    const softwareElement = screen.getByText('Mastodon/4.3.0')
    expect(softwareElement).toBeInTheDocument()
    expect(softwareElement.closest('div')).toHaveClass('mt-5')
  })

  it('omits software container when serverSoftware is null', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 10,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 5,
      followersCount: 15,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: null
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    // The handle itself contains `mastodon.social`; the software line is the
    // whole text `Mastodon` or `Mastodon/<version>`.
    expect(screen.queryByText(/^mastodon(\/.*)?$/i)).not.toBeInTheDocument()
  })

  it('renders the floating menu button, and no logo bar, under MobileNavigationProvider', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 10,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 5,
      followersCount: 15,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: null
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    const { container } = render(
      <MobileNavigationProvider>{element}</MobileNavigationProvider>
    )

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    expect(trigger).toHaveAttribute('data-floating-nav-trigger')
    // No title bar of any kind on the profile: no logo, no compact header.
    expect(
      screen.queryByRole('link', { name: 'Activities home' })
    ).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-mobile-compact-header]')
    ).not.toBeInTheDocument()
    // The cover's card is full-bleed and square below md, flush to the top.
    const card = container.querySelector('section') as HTMLElement
    expect(card).toHaveClass('max-md:rounded-none', 'max-md:border-t-0')
    expect(card.parentElement).not.toHaveClass('pt-6')
  })
  // Logged out the profile lives in PublicShell, which provides no mobile
  // navigation: the top bar stays at every width, so there is no floating
  // button and the card keeps its frame.
  it('renders no menu button and keeps the framed card without the signed-in provider', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: 'https://mastodon.social/@bob'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 10,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 5,
      followersCount: 15,
      isInternalAccount: false,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: [],
      isPixelfed: false,
      serverSoftware: null
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    const { container } = render(element)

    expect(
      screen.queryByRole('button', { name: 'Open navigation' })
    ).not.toBeInTheDocument()
    const card = container.querySelector('section') as HTMLElement
    expect(card).toHaveClass('rounded-2xl', 'border')
    expect(card).not.toHaveClass('max-md:rounded-none')
    expect(card).not.toHaveClass('max-md:border-t-0')
  })
})
