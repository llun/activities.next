/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

import {
  type DraftRecord,
  deleteAccountDrafts,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { DraftsProvider, useDrafts } from './DraftsProvider'

const draft = (id: string, actorId = 'actor-1'): DraftRecord => ({
  id,
  accountId: 'account-1',
  actorId,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'hello',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: []
})

const Probe = () => {
  const drafts = useDrafts()
  if (!drafts) return <p data-testid="probe">none</p>
  return (
    <p data-testid="probe">
      {`count=${drafts.count} epoch=${drafts.epoch} signingOut=${drafts.signingOut} actor=${drafts.actorId}`}
    </p>
  )
}

const renderProvider = (props: { accountId?: string; actorId?: string } = {}) =>
  render(
    <DraftsProvider
      accountId={props.accountId ?? 'account-1'}
      actorId={props.actorId ?? 'actor-1'}
    >
      <Probe />
    </DraftsProvider>
  )

describe('DraftsProvider', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
  })

  afterEach(() => {
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('useDrafts is null outside the provider', () => {
    render(<Probe />)

    expect(screen.getByTestId('probe')).toHaveTextContent('none')
  })

  it('is null for a signed-in actor without an account id', async () => {
    renderProvider({ accountId: '' })

    await act(async () => {})

    expect(screen.getByTestId('probe')).toHaveTextContent('none')
  })

  it('reads the epoch and counts this actor’s drafts on mount', async () => {
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
    await saveDraft(draft('b', 'actor-2'), { expectedRevision: 0, epoch: 0 })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent(
        'count=1 epoch=0 signingOut=false actor=actor-1'
      )
    )
  })

  it('re-counts on a changed message for this account, and ignores other accounts', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=0 epoch=0')
    )
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'another-account',
        actorId: 'actor-1',
        draftId: 'a'
      })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('count=0')

    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'a'
      })
    })
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1')
    )
  })

  it('sets signingOut on signing-out and clears it on sign-out-cancelled, for its own account only', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
    )

    act(() => {
      postDraftsMessage({ type: 'signing-out', accountId: 'another-account' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=false')

    act(() => {
      postDraftsMessage({ type: 'signing-out', accountId: 'account-1' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=true')

    act(() => {
      postDraftsMessage({ type: 'sign-out-cancelled', accountId: 'account-1' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=false')
  })

  it('re-counts when the tab becomes visible again', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=0')
    )
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1')
    )
  })

  it('reads the bumped epoch after a sign-out', async () => {
    await deleteAccountDrafts('account-1')

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=1')
    )
  })

  it('counts 0 and keeps rendering when storage is unavailable', async () => {
    setDraftsIndexedDBFactory(null)

    renderProvider()
    await act(async () => {})

    expect(screen.getByTestId('probe')).toHaveTextContent('count=0 epoch=null')
  })

  it('exposes notifySavedToDrafts without throwing', async () => {
    let notify: ((id: string) => void) | undefined
    const Grab = () => {
      notify = useDrafts()?.notifySavedToDrafts
      return null
    }
    render(
      <DraftsProvider accountId="account-1" actorId="actor-1">
        <Grab />
      </DraftsProvider>
    )
    await act(async () => {})

    expect(() => act(() => notify?.('d1'))).not.toThrow()
  })
})
