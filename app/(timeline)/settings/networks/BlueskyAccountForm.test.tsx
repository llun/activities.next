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
  setBlueskyCrosspostByDefault,
  setBlueskyInstanceHandle,
  startBlueskySignIn,
  unlinkBlueskyAccount
} from '@/lib/client'
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount,
  useLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import type {
  BlueskyAccountState,
  BlueskyLinkedAccount
} from '@/lib/utils/blueskyAccount'

import { BlueskyAccountForm } from './BlueskyAccountForm'

vi.mock('@/lib/client', () => ({
  checkBlueskyHandle: vi.fn(),
  linkBlueskyAppPassword: vi.fn(),
  setBlueskyCrosspostByDefault: vi.fn(),
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
  sessionActive: true,
  lastSyncedAt: null,
  syncError: null,
  crosspostByDefault: true
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

  it('says when Home has not synced yet', () => {
    show(linkedState())
    expect(screen.getByText('Not synced yet')).toBeInTheDocument()
  })

  it('shows when Home last synced and why the latest sync failed', () => {
    const syncedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    show(
      linkedState({
        lastSyncedAt: syncedAt,
        syncError:
          'Bluesky refused the request (502). Trying again in a few minutes.'
      })
    )
    expect(screen.getByText('Last synced 3 minutes ago')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Bluesky refused the request (502). Trying again in a few minutes.'
      )
    ).toBeInTheDocument()
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

  it('lets go of a claim this profile can no longer hold', async () => {
    vi.mocked(setBlueskyInstanceHandle).mockResolvedValue(linkedState())
    show(
      linkedState(
        {},
        { instanceHandle: { host: 'social.example', status: 'inactive' } }
      )
    )
    expect(
      screen.getByText(/Your claim on social.example is not in use/)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Let it go' }))
    await waitFor(() =>
      expect(setBlueskyInstanceHandle).toHaveBeenCalledWith(false)
    )
  })

  it('explains a claim a hosted account overrides and lets it go', async () => {
    vi.mocked(setBlueskyInstanceHandle).mockResolvedValue(linkedState())
    show(
      linkedState(
        {},
        { instanceHandle: { host: 'social.example', status: 'hosted' } }
      )
    )
    expect(
      screen.getByText(
        'A Bluesky account hosted on this server answers for this name.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/only an admin’s profile on that domain/)
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Let it go' }))
    await waitFor(() =>
      expect(setBlueskyInstanceHandle).toHaveBeenCalledWith(false)
    )
  })

  it('shows the already-linked error from the callback', () => {
    show(unlinkedState, 'did_taken')
    expect(
      screen.getByText(
        'This Bluesky account is already linked to another profile on this server.'
      )
    ).toBeInTheDocument()
  })

  describe('Post to Bluesky by default', () => {
    const ACTOR = 'https://activities.local/users/alice'
    // Reads the store the way an open composer does.
    const ComposerDefault = () => {
      const linked = useLinkedBlueskyAccount(ACTOR)
      return <p>composer default: {String(linked?.crosspostByDefault)}</p>
    }
    const switchRow = () =>
      screen.getByRole('switch', { name: 'Post to Bluesky by default' })

    beforeEach(() => {
      setLinkedBlueskyAccount(ACTOR, account)
    })
    afterEach(() => {
      resetBlueskyAccountStore()
    })

    it('turns the default off and open composers follow it', async () => {
      vi.mocked(setBlueskyCrosspostByDefault).mockResolvedValue()
      render(
        <>
          <BlueskyAccountForm initialState={linkedState()} />
          <ComposerDefault />
        </>
      )
      expect(switchRow()).toBeChecked()
      expect(switchRow()).toHaveAccessibleDescription(
        'New public posts also go to your Bluesky account. You can turn it off for one post in the post box.'
      )

      fireEvent.click(switchRow())
      await waitFor(() => expect(switchRow()).not.toBeChecked())
      expect(setBlueskyCrosspostByDefault).toHaveBeenCalledWith(false)
      expect(screen.getByText('composer default: false')).toBeInTheDocument()
    })

    it('keeps the switch and shows an alert when saving fails', async () => {
      vi.mocked(setBlueskyCrosspostByDefault).mockRejectedValue(
        new Error('Unable to update the Bluesky setting.')
      )
      render(
        <>
          <BlueskyAccountForm
            initialState={linkedState({ crosspostByDefault: false })}
          />
          <ComposerDefault />
        </>
      )
      expect(switchRow()).not.toBeChecked()

      fireEvent.click(switchRow())
      expect(
        await screen.findByText('Unable to update the Bluesky setting.')
      ).toBeInTheDocument()
      expect(switchRow()).not.toBeChecked()
      expect(screen.getByText('composer default: true')).toBeInTheDocument()
    })
  })
})
