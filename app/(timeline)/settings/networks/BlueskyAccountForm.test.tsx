/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  checkBlueskyHandle,
  linkBlueskyAppPassword,
  setBlueskyInstanceHandle,
  startBlueskySignIn,
  unlinkBlueskyAccount
} from '@/lib/client'
import type {
  BlueskyAccountState,
  BlueskyLinkedAccount
} from '@/lib/utils/blueskyAccount'

import { BlueskyAccountForm } from './BlueskyAccountForm'

vi.mock('@/lib/client', () => ({
  checkBlueskyHandle: vi.fn(),
  linkBlueskyAppPassword: vi.fn(),
  setBlueskyInstanceHandle: vi.fn(),
  startBlueskySignIn: vi.fn(),
  unlinkBlueskyAccount: vi.fn()
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const account: BlueskyLinkedAccount = {
  did: 'did:plc:abc123',
  handle: 'alice.example.com',
  pdsUrl: 'https://pds.example.net',
  authType: 'oauth',
  domainHandle: true,
  sessionActive: true
}

const unlinkedState: BlueskyAccountState = {
  oauthAvailable: true,
  account: null,
  instanceHandle: null
}

const linkedState = (
  overrides: Partial<BlueskyLinkedAccount> = {},
  state: Partial<BlueskyAccountState> = {}
): BlueskyAccountState => ({
  oauthAvailable: true,
  account: { ...account, ...overrides },
  instanceHandle: null,
  ...state
})

const show = (state: BlueskyAccountState, callbackResult?: string | null) =>
  render(
    <BlueskyAccountForm
      initialState={state}
      callbackResult={callbackResult ?? null}
    />
  )

describe('BlueskyAccountForm', () => {
  const originalLocation = window.location
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('starts Bluesky sign-in and opens the returned URL', async () => {
    vi.mocked(startBlueskySignIn).mockResolvedValue(
      'https://bsky.social/oauth/authorize?request=abc'
    )
    show(unlinkedState)
    fireEvent.change(screen.getByLabelText('Handle'), {
      target: { value: 'alice.example.com' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Bluesky' })
    )
    await waitFor(() =>
      expect(startBlueskySignIn).toHaveBeenCalledWith('alice.example.com')
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'https://bsky.social/oauth/authorize?request=abc'
      )
    )
  })

  it('links with an app password after switching away from sign-in', async () => {
    vi.mocked(linkBlueskyAppPassword).mockResolvedValue(linkedState())
    show(unlinkedState)
    fireEvent.click(
      screen.getByRole('button', { name: 'Use an app password instead' })
    )
    fireEvent.change(screen.getByLabelText('Handle'), {
      target: { value: 'alice.example.com' }
    })
    fireEvent.change(screen.getByLabelText('App password'), {
      target: { value: 'abcd-efgh-ijkl-mnop' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Link account' }))
    await waitFor(() =>
      expect(linkBlueskyAppPassword).toHaveBeenCalledWith(
        'alice.example.com',
        'abcd-efgh-ijkl-mnop'
      )
    )
  })

  it('shows the app password field straight away when OAuth is unavailable', () => {
    show({ ...unlinkedState, oauthAvailable: false })
    expect(screen.getByLabelText('App password')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in with Bluesky' })
    ).not.toBeInTheDocument()
  })

  it('shows a rejected client call as an alert', async () => {
    vi.mocked(startBlueskySignIn).mockRejectedValue(
      new Error('Bluesky is unreachable.')
    )
    show(unlinkedState)
    fireEvent.change(screen.getByLabelText('Handle'), {
      target: { value: 'alice.example.com' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Bluesky' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bluesky is unreachable.'
    )
  })

  it('shows the DNS record for a domain handle and verifies it', async () => {
    vi.mocked(checkBlueskyHandle).mockResolvedValue({
      handle: 'alice.example.com',
      verified: true,
      dnsRecord: true
    })
    show(linkedState())
    expect(screen.getByText('_atproto.alice.example.com')).toBeInTheDocument()
    expect(screen.getByText('did=did:plc:abc123')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check handle' }))
    await waitFor(() => expect(checkBlueskyHandle).toHaveBeenCalled())
    expect(await screen.findByText('Verified')).toBeInTheDocument()
  })

  it('hides the DNS record for a handle the PDS hands out', () => {
    show(linkedState({ domainHandle: false }))
    expect(
      screen.queryByText('_atproto.alice.example.com')
    ).not.toBeInTheDocument()
  })

  it('unlinks the account after confirmation', async () => {
    vi.mocked(unlinkBlueskyAccount).mockResolvedValue(unlinkedState)
    show(linkedState())
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(unlinkBlueskyAccount).toHaveBeenCalled())
  })

  it('warns when Bluesky ended the stored session', () => {
    show(linkedState({ sessionActive: false }))
    expect(screen.getByText('Bluesky ended this session.')).toBeInTheDocument()
  })

  it('claims a free server handle', async () => {
    vi.mocked(setBlueskyInstanceHandle).mockResolvedValue(
      linkedState(
        {},
        { instanceHandle: { host: 'social.example', status: 'yours' } }
      )
    )
    show(
      linkedState(
        {},
        { instanceHandle: { host: 'social.example', status: 'free' } }
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use social.example' }))
    await waitFor(() =>
      expect(setBlueskyInstanceHandle).toHaveBeenCalledWith(true)
    )
  })

  it('says when another profile answers for the server handle', () => {
    show(
      linkedState(
        {},
        { instanceHandle: { host: 'social.example', status: 'taken' } }
      )
    )
    expect(
      screen.getByText('Another profile answers for social.example.')
    ).toBeInTheDocument()
  })

  it('shows the already-linked error from the callback', () => {
    show(unlinkedState, 'did_taken')
    expect(
      screen.getByText(
        'This Bluesky account is already linked to another profile on this server.'
      )
    ).toBeInTheDocument()
  })
})
