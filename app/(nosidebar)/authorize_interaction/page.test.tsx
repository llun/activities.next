/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { redirect } from 'next/navigation'

import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const mockDatabase = {}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ host: 'llun.test' }))
}))

vi.mock('@/lib/services/guards/headerHost', () => ({
  headerHost: () => 'llun.test'
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/services/actors/resolveAccountTarget', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/services/actors/resolveAccountTarget')
  >('@/lib/services/actors/resolveAccountTarget')
  return {
    ACCOUNT_TARGET_MAX_LENGTH: actual.ACCOUNT_TARGET_MAX_LENGTH,
    resolveAccountTarget: vi.fn()
  }
})

vi.mock('./AuthorizeInteractionCard', () => ({
  AuthorizeInteractionCard: ({
    actor,
    isSelf
  }: {
    actor: { id: string }
    isSelf: boolean
  }) => (
    <div data-testid="card" data-self={String(isSelf)}>
      {actor.id}
    </div>
  )
}))

const currentActor = {
  id: 'https://llun.test/users/viewer',
  username: 'viewer',
  domain: 'llun.test'
} as Actor

const remoteActor = {
  id: 'https://remote.test/users/someone',
  username: 'someone',
  domain: 'remote.test'
} as Actor

const renderPage = async (searchParams: Record<string, string | string[]>) => {
  const element = await Page({ searchParams: Promise.resolve(searchParams) })
  return render(element)
}

describe('authorize_interaction page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    vi.mocked(getActorFromSession).mockResolvedValue(currentActor)
    vi.mocked(resolveAccountTarget).mockResolvedValue({
      type: 'resolved',
      actor: remoteActor
    })
  })

  it('renders the confirmation card for a resolved account', async () => {
    await renderPage({ uri: 'someone@remote.test' })

    expect(screen.getByTestId('card')).toHaveTextContent(
      'https://remote.test/users/someone'
    )
    expect(screen.getByTestId('card')).toHaveAttribute('data-self', 'false')
  })

  it('marks the card as self when the target is the viewer', async () => {
    vi.mocked(resolveAccountTarget).mockResolvedValue({
      type: 'resolved',
      actor: currentActor
    })

    await renderPage({ uri: 'viewer@llun.test' })

    expect(screen.getByTestId('card')).toHaveAttribute('data-self', 'true')
  })

  it('redirects a signed out visitor to sign in and back', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null)

    await renderPage({ uri: 'someone@remote.test' })

    expect(redirect).toHaveBeenCalledTimes(1)
    const target = new URL(vi.mocked(redirect).mock.calls[0][0])
    expect(target.origin).toEqual('https://llun.test')
    expect(target.pathname).toEqual('/auth/signin')
    // searchParams.get decodes once, leaving the path the sign-in page will
    // redirect to; Next decodes the inner uri once more when this page re-reads
    // its search params.
    expect(target.searchParams.get('redirectBack')).toEqual(
      '/authorize_interaction?uri=someone%40remote.test'
    )
    expect(resolveAccountTarget).not.toHaveBeenCalled()
  })

  it('keeps an ampersand in the uri intact through the sign in round trip', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null)

    await renderPage({ uri: 'https://remote.test/users/a?b=1&c=2' })

    const target = new URL(vi.mocked(redirect).mock.calls[0][0])
    const redirectBack = target.searchParams.get('redirectBack') as string
    const resumed = new URL(redirectBack, 'https://llun.test')
    expect(resumed.searchParams.get('uri')).toEqual(
      'https://remote.test/users/a?b=1&c=2'
    )
  })

  it.each([
    {
      description: 'renders the not found state',
      result: { type: 'not-found' as const },
      text: 'Account not found'
    },
    {
      description: 'renders the forbidden state',
      result: { type: 'forbidden' as const },
      text: "Can't reach that server"
    },
    {
      description: 'renders the invalid state',
      result: { type: 'invalid' as const },
      text: "That doesn't look like an account"
    }
  ])('$description', async ({ result, text }) => {
    vi.mocked(resolveAccountTarget).mockResolvedValue(result)

    await renderPage({ uri: 'whatever' })

    expect(screen.getByText(text)).toBeInTheDocument()
    // The value came from a remote server, so it is shown as inert text.
    expect(screen.queryByRole('link', { name: 'whatever' })).toBeNull()
  })

  it('renders the empty state without resolving when uri is missing', async () => {
    await renderPage({})

    expect(screen.getByText('Nothing to follow')).toBeInTheDocument()
    expect(resolveAccountTarget).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('uses the first value when uri repeats', async () => {
    await renderPage({ uri: ['someone@remote.test', 'other@remote.test'] })

    expect(resolveAccountTarget).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'someone@remote.test' })
    )
  })

  it('rejects an over long uri without resolving it', async () => {
    await renderPage({ uri: `user@${'a'.repeat(4000)}.test` })

    expect(screen.getByText('Nothing to follow')).toBeInTheDocument()
    expect(resolveAccountTarget).not.toHaveBeenCalled()
  })
})
