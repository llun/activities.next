/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

import {
  type DraftRecord,
  deleteDraft,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { DraftsLink } from './DraftsLink'
import { DraftsProvider } from './DraftsProvider'

const draft = (id: string, actorId = 'actor-1'): DraftRecord => ({
  id,
  accountId: 'account-1',
  actorId,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: id,
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: []
})

const seed = (...ids: string[]) =>
  Promise.all(
    ids.map((id) => saveDraft(draft(id), { expectedRevision: 0, epoch: 0 }))
  )

const renderLink = (excludeId?: string | null) =>
  render(
    <DraftsProvider accountId="account-1" actorId="actor-1">
      <DraftsLink excludeId={excludeId} />
    </DraftsProvider>
  )

describe('DraftsLink', () => {
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

  it('renders nothing outside a provider', () => {
    const { container } = render(<DraftsLink />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing at zero', async () => {
    const { container } = renderLink()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(container).toBeEmptyDOMElement()
  })

  it('says "1 draft" and "2 drafts" and links to /drafts', async () => {
    await seed('a')
    renderLink()
    expect(await screen.findByText(/1 draft ·/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/drafts'
    )

    await seed('b')
    postDraftsMessage({
      type: 'changed',
      accountId: 'account-1',
      actorId: 'actor-1',
      draftId: 'b'
    })
    expect(await screen.findByText(/2 drafts ·/)).toBeInTheDocument()
  })

  it('leaves out the draft being typed', async () => {
    await seed('a', 'typing')
    renderLink('typing')

    expect(await screen.findByText(/1 draft ·/)).toBeInTheDocument()
  })

  it('is hidden when the only draft is the one being typed', async () => {
    await seed('typing')
    const { container } = renderLink('typing')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(container).toBeEmptyDOMElement()
  })

  it('follows a draft deleted elsewhere', async () => {
    await seed('a')
    const { container } = renderLink()
    await screen.findByText(/1 draft ·/)

    await deleteDraft('a')
    postDraftsMessage({
      type: 'changed',
      accountId: 'account-1',
      actorId: 'actor-1',
      draftId: 'a'
    })

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('counts only this actor', async () => {
    await saveDraft(draft('theirs', 'actor-2'), {
      expectedRevision: 0,
      epoch: 0
    })
    const { container } = renderLink()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(container).toBeEmptyDOMElement()
  })
})
