/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getBlueskyAccountState } from '@/lib/services/bluesky/account'
import { getBlueskySharingState } from '@/lib/services/blueskySharing'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/database', () => ({ getDatabase: () => database }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: async () => ({ user: { email: 'alice@example.com' } })
}))
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))
vi.mock('@/lib/services/bluesky/account', () => ({
  getBlueskyAccountState: vi.fn()
}))
vi.mock('@/lib/services/blueskySharing', () => ({
  getBlueskySharingState: vi.fn()
}))
vi.mock('@/lib/client', () => ({
  updateBlueskySharing: vi.fn(),
  checkBlueskyHandle: vi.fn(),
  linkBlueskyAppPassword: vi.fn(),
  setBlueskyInstanceHandle: vi.fn(),
  startBlueskySignIn: vi.fn(),
  unlinkBlueskyAccount: vi.fn()
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  }
}))

const database = {}
const actor = {
  id: 'https://personal.example/users/alice',
  account: { id: 'account' }
}

describe('/settings/networks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(actor as never)
    vi.mocked(getBlueskyAccountState).mockResolvedValue({
      oauthAvailable: true,
      account: null,
      instanceHandle: null
    })
    vi.mocked(getBlueskySharingState).mockResolvedValue({
      status: 'Off',
      handle: 'alice.personal.example.ap.brid.gy',
      requirements: [],
      federationAllowed: true
    })
  })

  it('renders the current profile’s stored state in one shared form box', async () => {
    const { container } = render(await Page())
    expect(screen.getByRole('heading', { name: 'Bluesky' })).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Share my posts on Bluesky' })
    ).not.toBeChecked()
    expect(
      screen.getByText(
        'To follow someone on Bluesky, search for their handle, like alice.bsky.social.'
      )
    ).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="frame"]')).toHaveLength(2)
    expect(getBlueskyAccountState).toHaveBeenCalledWith(database, actor)
    expect(getBlueskySharingState).toHaveBeenCalledWith(database, actor)
  })

  it('shows the callback notice from the search params', async () => {
    render(await Page({ searchParams: Promise.resolve({ bluesky: 'linked' }) }))
    expect(screen.getByText('Bluesky account linked.')).toBeInTheDocument()
  })

  it('redirects unauthenticated visitors', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null)
    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
    expect(getBlueskyAccountState).not.toHaveBeenCalled()
    expect(getBlueskySharingState).not.toHaveBeenCalled()
  })
})
